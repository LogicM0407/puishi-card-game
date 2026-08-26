"use strict";

const app = document.getElementById("app");
const identityKey = "puishi-card-player-id-v1";
const savedId = sessionStorage.getItem(identityKey);
const playerId = savedId || ("p_" + cryptoRandom(10));

function saveRoomSession(code, name) {
  try {
    localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify({
      roomCode: code,
      playerName: name,
      playerId: playerId,
      savedAt: Date.now()
    }));
  } catch (_) {}
}

function loadRoomSession() {
  try {
    const raw = localStorage.getItem(ROOM_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.roomCode || !data.playerId) return null;
    if (Date.now() - (data.savedAt || 0) > 30 * 60 * 1000) {
      localStorage.removeItem(ROOM_STORAGE_KEY);
      return null;
    }
    return data;
  } catch (_) { return null; }
}

function clearRoomSession() {
  try { localStorage.removeItem(ROOM_STORAGE_KEY); } catch (_) {}
}

const ui = {
  screen: "entry",
  busy: false,
  message: "",
  messageError: false,
  modal: null,
  toast: "",
  toastTimer: null,
  rulesOpen: false,
  pendingRequest: false,
  pendingAction: null,
  pendingActionTimer: null,
  syncTimer: null,
  botTimer: null,
  eventChoice: null,
  joinResolver: null,
  migrationTimer: null,
  hostLostAt: 0,
  hostPeriodicTimer: null,
  gapTimer: null,
  chatMessages: [],
  chatInput: "",
  chatOpen: false,
  chatLastSent: 0,
  heartbeatTimer: null,
  heartbeatMisses: 0,
  mutedPlayerIds: new Set(),
  blockedPlayerIds: null
};

const room = {
  connected: false,
  code: "",
  myId: playerId,
  myName: "",
  hostId: "",
  isHost: false,
  lifecycle: ROOM_STATE.WAITING,
  settings: { totalRounds: 10, botDifficulty: "simple", globalStateEnabled: false },
  members: [],
  transport: null
};

let game = null;
const processedGameActions = new Map();

ui.blockedPlayerIds = loadBlockedPlayers();
render();

(function loadOptionalLibraries() {
  const lucideScript = document.createElement("script");
  lucideScript.src = "https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js";
  lucideScript.onload = function () { if (typeof initIcons === "function") initIcons(); };
  document.head.appendChild(lucideScript);

  const sources = [
    "./peerjs.min.js",
    "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js",
    "https://cdn.bootcdn.net/ajax/libs/peerjs/1.5.4/peerjs.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js"
  ];
  let index = 0;
  function next() {
    if (typeof window.Peer !== "undefined") {
      window.dispatchEvent(new Event("peerjs-ready"));
      return;
    }
    if (index >= sources.length) {
      window.__peerjsFailed = true;
      window.dispatchEvent(new Event("peerjs-failed"));
      return;
    }
    const script = document.createElement("script");
    script.src = sources[index++];
    script.onload = next;
    script.onerror = next;
    document.head.appendChild(script);
  }
  next();
})();

function waitForPeerJS(timeout = 16000) {
  if (typeof window.Peer !== "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("PeerJS 加载超时"));
    }, timeout);
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("PeerJS 库加载失败")); };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("peerjs-ready", ready);
      window.removeEventListener("peerjs-failed", failed);
    };
    window.addEventListener("peerjs-ready", ready, { once: true });
    window.addEventListener("peerjs-failed", failed, { once: true });
  });
}

class PeerTransport {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.peer = null;
    this.myPeerId = "";
    this.isHost = false;
    this.hostConnection = null;
    this.connections = new Map();
    this.onMessage = null;
    this.onPeerLeft = null;
    this.onHostLost = null;
    this.closed = false;
  }

  logTransport(level, tag, extra) {
    try {
      const fn = console[level] || console.log;
      fn.call(console, `[P2P][${tag}]`, {
        room: this.roomCode,
        peer: this.myPeerId,
        isHost: this.isHost,
        at: new Date().toISOString(),
        ...extra
      });
    } catch (_) {}
  }

  peerOptions() {
    return {
      debug: 0,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun.miwifi.com:3478" },
          { urls: "stun:stun.chat.bilibili.com:3478" },
          // TURN 中继兜底：对称型 NAT / 企业防火墙等 P2P 直连失败时走中继。
          // 当前使用公共免费 TURN（openrelay），生产环境建议替换为自建 coturn 以保证国内可用性。
          {
            urls: [
              "turn:openrelay.metered.ca:80",
              "turn:openrelay.metered.ca:443",
              "turn:openrelay.metered.ca:443?transport=tcp"
            ],
            username: "openrelayproject",
            credential: "openrelayproject"
          }
        ]
      }
    };
  }

  hostPeerId() {
    return `puishi-v100-${this.roomCode}-host`;
  }

  async startHost() {
    await waitForPeerJS();
    this.isHost = true;
    this.myPeerId = this.hostPeerId();
    this.peer = new Peer(this.myPeerId, this.peerOptions());
    this.peer.on("error", error => {
      this.logTransport("error", "peer-error", { message: String(error?.message || error), type: error?.type || "" });
    });
    const pendingConnections = [];
    let connectionHandler = null;
    this.peer.on("connection", connection => {
      if (connectionHandler) connectionHandler(connection);
      else pendingConnections.push(connection);
    });
    await this.waitForPeerOpen();
    connectionHandler = connection => this.attachConnection(connection);
    pendingConnections.splice(0).forEach(connectionHandler);
  }

  async startClient() {
    await waitForPeerJS();
    this.isHost = false;
    this.myPeerId = `puishi-v100-client-${cryptoRandom(10)}`;
    this.peer = new Peer(this.myPeerId, this.peerOptions());
    this.peer.on("error", error => {
      this.logTransport("error", "peer-error", { message: String(error?.message || error), type: error?.type || "" });
    });
    await this.waitForPeerOpen();
    const connection = this.peer.connect(this.hostPeerId(), { reliable: true, serialization: "binary" });
    this.hostConnection = connection;
    this.attachConnection(connection);
    await this.waitForConnectionOpen(connection);
  }

  waitForPeerOpen() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("PeerJS 连接超时")), 20000);
      this.peer.once("open", () => { clearTimeout(timer); resolve(); });
      this.peer.once("error", error => { clearTimeout(timer); reject(error); });
    });
  }

  waitForConnectionOpen(connection) {
    return new Promise((resolve, reject) => {
      if (connection.open) return resolve();
      const timer = setTimeout(() => reject(new Error("连接房主超时，请确认房间码正确且房主在线后重试")), 25000);
      connection.once("open", () => { clearTimeout(timer); resolve(); });
      connection.once("error", error => { clearTimeout(timer); reject(error); });
    });
  }

  attachConnection(connection) {
    if (!this.connections.has(connection.peer)) {
      this.connections.set(connection.peer, { connection, playerId: null, name: "" });
    }
    connection.on("data", data => {
      let message = data;
      if (typeof data === "string") {
        try { message = JSON.parse(data); } catch (err) {
          this.logTransport("error", "parse-error", { message: String(err?.message || err), length: data.length });
          return;
        }
      }
      const record = this.connections.get(connection.peer);
      if (message?.type === "JOIN" && record) {
        record.playerId = message.playerId;
        record.name = message.name;
      }
      this.onMessage?.(message, { peerId: connection.peer, playerId: record?.playerId || message?.playerId || null });
    });
    connection.on("close", () => {
      const record = this.connections.get(connection.peer);
      this.connections.delete(connection.peer);
      if (this.closed) return;
      this.logTransport("warn", "connection-closed", { peer: connection.peer, playerId: record?.playerId || null });
      if (this.isHost) this.onPeerLeft?.({ peerId: connection.peer, playerId: record?.playerId || null });
      else this.onHostLost?.();
    });
    connection.on("error", error => {
      this.logTransport("error", "connection-error", { message: String(error?.message || error), type: error?.type || "", peer: connection.peer });
    });
  }

  bindPlayer(peerId, playerId, name) {
    const record = this.connections.get(peerId);
    if (!record) return;
    for (const [existingPeerId, existing] of this.connections) {
      if (existingPeerId === peerId || existing.playerId !== playerId) continue;
      existing.playerId = null;
      try { existing.connection.close(); } catch (_) {}
    }
    record.playerId = playerId;
    record.name = name;
  }

  send(connection, message) {
    if (!connection?.open) {
      this.logTransport("warn", "send-closed", { messageType: message?.type || "" });
      return false;
    }
    try {
      if (message?.type === "STATE_EVENT" || message?.type === "SNAPSHOT") {
        let bytes = 0;
        try { bytes = JSON.stringify(message).length; } catch (_) {}
        if (bytes > PEER_SAFE_MESSAGE_BYTES) {
          this.logTransport("warn", "large-message", { messageType: message.type, bytes });
        }
      }
      connection.send(message);
      return true;
    } catch (err) {
      this.logTransport("error", "send-error", { messageType: message?.type || "", message: String(err?.message || err) });
      return false;
    }
  }

  sendToHost(message) {
    return this.send(this.hostConnection, message);
  }

  sendToPlayer(playerId, message) {
    for (const record of this.connections.values()) {
      if (record.playerId === playerId && this.send(record.connection, message)) {
        return true;
      }
    }
    return false;
  }

  broadcast(message) {
    for (const record of this.connections.values()) this.send(record.connection, message);
  }

  close() {
    this.closed = true;
    for (const record of this.connections.values()) {
      try { record.connection.close(); } catch (_) {}
    }
    this.connections.clear();
    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
    }
    this.peer = null;
    this.hostConnection = null;
  }
}
