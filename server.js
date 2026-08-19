/* ===============================================================
 * 谱师卡牌 · 跨设备 WebSocket 中继服务器
 *   · HTTP + WebSocket 共用同一端口（默认 8080）
 *   · 静态文件：/game.html 等直接从当前目录托管
 *   · WebSocket：/ws
 *   · 房间：按 5 位 roomCode 隔离；消息完全透传
 *   · 支持跨设备局域网联机
 * =============================================================== */
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { WebSocketServer } = require('ws');

const PORT  = parseInt(process.env.PORT, 10) || 8080;
const ROOT  = __dirname;
const WS_PATH = '/ws';

const MIME = {
  '.html' : 'text/html; charset=utf-8',
  '.htm'  : 'text/html; charset=utf-8',
  '.js'   : 'application/javascript; charset=utf-8',
  '.mjs'  : 'application/javascript; charset=utf-8',
  '.css'  : 'text/css; charset=utf-8',
  '.json' : 'application/json; charset=utf-8',
  '.svg'  : 'image/svg+xml',
  '.png'  : 'image/png',
  '.jpg'  : 'image/jpeg',
  '.jpeg' : 'image/jpeg',
  '.gif'  : 'image/gif',
  '.ico'  : 'image/x-icon',
  '.webp' : 'image/webp',
  '.wasm' : 'application/wasm',
  '.map'  : 'application/json; charset=utf-8',
  '.txt'  : 'text/plain; charset=utf-8',
  '.md'   : 'text/markdown; charset=utf-8',
};

/* ---------- 1. 创建 HTTP 服务器 ---------- */
const server = http.createServer((req, res) => {
  // 处理 WebSocket upgrade 请求
  if (req.url && req.url.startsWith(WS_PATH)) {
    // 这是 WebSocket 请求，由 ws 库处理
    return;
  }

  // 本地 PeerJS 路由 - 从 node_modules 加载
  if (req.url === '/peerjs.min.js') {
    const peerjsPath = path.join(ROOT, 'node_modules/peerjs/dist/peerjs.min.js');
    if (fs.existsSync(peerjsPath)) {
      const data = fs.readFileSync(peerjsPath);
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(data);
    }
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (_) {
    res.writeHead(400); return res.end('Bad Request');
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/game.html';

  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      filePath = path.join(ROOT, 'game.html');
      if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
    }
    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (e2, data) => {
      if (e2) { res.writeHead(500); return res.end('Read Error'); }
      const headers = {
        'Content-Type'                : MIME[ext] || 'application/octet-stream',
        'Cache-Control'               : 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin' : '*',
      };
      res.writeHead(200, headers);
      res.end(data);
    });
  });
});

/* ---------- 2. 创建 WebSocket 服务器 ---------- */
const wss = new WebSocketServer({ 
  server: server, 
  path: WS_PATH,
  // 允许跨域
  handleProtocols: null,
});

/* ---------- 3. 房间管理 ---------- */
/** @type {Map<string, { clients:Set<WebSocket>, lastActive:number }>} */
const rooms = new Map();

function getOrCreateRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = { clients: new Set(), lastActive: Date.now(), createdAt: Date.now() };
    rooms.set(code, r);
    console.log(`[房间] 创建新房: ${code}`);
  } else {
    r.lastActive = Date.now();
  }
  return r;
}

function broadcastToRoom(room, message, excludeWs) {
  const out = JSON.stringify(message);
  for (const client of room.clients) {
    if (client === excludeWs) continue;
    if (client.readyState === 1) {
      client.send(out);
    }
  }
}

// 定期清理空房间（超过 1 小时没人的）
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [code, room] of rooms.entries()) {
    if (room.clients.size === 0 && now - room.lastActive > 3600_000) {
      rooms.delete(code);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[清理] 清理了 ${cleaned} 个过期空房间`);
}, 600_000).unref?.();

/* ---------- 4. WebSocket 连接处理 ---------- */
wss.on('connection', (ws, req) => {
  ws.roomCode = null;
  ws.playerId = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  console.log(`[连接] 新客户端连接，来自: ${req.socket.remoteAddress}`);

  ws.on('message', (raw) => {
    let msg;
    try { 
      msg = JSON.parse(raw.toString()); 
    } catch (_) { 
      console.log('[消息] 无效的 JSON 消息');
      return; 
    }
    
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      console.log('[消息] 消息缺少 type 字段');
      return;
    }

    const code = typeof msg.roomCode === 'string' ? msg.roomCode.toUpperCase() : null;
    if (!code) {
      console.log('[消息] 消息缺少 roomCode');
      return;
    }

    // 首次绑定房间
    if (ws.roomCode === null) {
      ws.roomCode = code;
      console.log(`[房间] 客户端加入房间: ${code}`);
    } else if (ws.roomCode !== code) {
      console.log(`[房间] 客户端尝试切换房间: ${ws.roomCode} -> ${code}`);
      return;
    }

    const room = getOrCreateRoom(code);
    room.clients.add(ws);

    // 记录 fromId（用于断线 leave）
    if (typeof msg.fromId === 'string' && !ws.playerId) {
      ws.playerId = msg.fromId;
      console.log(`[玩家] 玩家 ${msg.fromId} 加入房间 ${code}`);
    }

    // 消息广播给房间内其他人（不回显发送者）
    broadcastToRoom(room, msg, ws);
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    
    room.clients.delete(ws);
    console.log(`[断开] 客户端离开房间: ${ws.roomCode}, 剩余 ${room.clients.size} 人`);
    
    // 断线自动代为广播 leave
    if (ws.playerId) {
      const leaveMsg = {
        type: 'leave',
        roomCode: ws.roomCode,
        playerId: ws.playerId,
        fromId: ws.playerId,
        _auto: true,
      };
      broadcastToRoom(room, leaveMsg, ws);
    }
    
    if (room.clients.size === 0) {
      rooms.delete(ws.roomCode);
      console.log(`[房间] 房间 ${ws.roomCode} 已清空，自动删除`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[错误] WebSocket 错误:`, err.message);
    try { ws.close(); } catch (_) {}
  });
});

// 心跳：防止 NAT/代理把空闲连接掐断
const HEARTBEAT_MS = 20_000;
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { 
      console.log('[心跳] 检测到无响应的客户端，强制断开');
      try { ws.terminate(); } catch (_) { }
      continue; 
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) { }
  }
}, HEARTBEAT_MS).unref?.();

/* ---------- 5. 启动服务器 ---------- */
server.listen(PORT, '0.0.0.0', () => {
  const hr = process.stdout;
  hr.write('\n');
  hr.write('  ╔══════════════════════════════════════════════════════════════╗\n');
  hr.write('  ║          🟣 谱师卡牌 · WebSocket 联机服务器                  ║\n');
  hr.write('  ╠══════════════════════════════════════════════════════════════╣\n');
  hr.write(`  ║  端口  : ${String(PORT).padEnd(51)}║\n`);
  hr.write(`  ║  本机  : http://localhost:${String(PORT).padEnd(37)}║\n`);
  hr.write(`  ║  WS    : ws://<host>:${PORT}/ws                             ║\n`);
  hr.write('  ╠══════════════════════════════════════════════════════════════╣\n');

  const ifaces = os.networkInterfaces();
  let cardCount = 0;
  for (const name of Object.keys(ifaces || {})) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        cardCount++;
        const url = `http://${iface.address}:${PORT}/game.html`;
        hr.write(`  ║  网卡 ${String(cardCount).padEnd(2)} : ${url.padEnd(52, ' ').slice(0, 52)} ║\n`);
      }
    }
  }
  if (cardCount === 0) {
    hr.write('  ║  (未找到 IPv4 网卡，仅本地可用)                              ║\n');
  } else {
    hr.write('  ║  ⚠️  同 Wi-Fi 队友把上面任一条 http://...:8080/game.html     ║\n');
    hr.write('  ║      粘贴到手机/另一台电脑浏览器；无需手动改房间码。         ║\n');
  }
  hr.write('  ╚══════════════════════════════════════════════════════════════╝\n\n');
  hr.write('  💡 快速开始：\n');
  hr.write('     1. 在同一局域网设备（手机/电脑）浏览器访问上方地址\n');
  hr.write('     2. 点击"联机房间" → 创建房间 / 加入房间\n');
  hr.write('     3. 输入相同的房间码即可开始游戏\n\n');
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`❌ 端口 ${PORT} 已被占用。换端口： PORT=9000 node server.js`);
    process.exit(1);
  }
  console.error('服务器错误：', err);
});