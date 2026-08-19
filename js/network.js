"use strict";

const syncHost = {
  eventLog: [],
  clientAcks: new Map()
};

const syncClient = {
  lastAppliedSeq: 0,
  pendingEvents: new Map(),
  gapRequest: null,
  lastAckSent: 0
};

function trimEventLog() {
  while (syncHost.eventLog.length > EVENT_LOG_MAX) syncHost.eventLog.shift();
}

function commitGameState(action, actorId, requestId, result) {
  if (!result) {
    game.sequence++;
    result = { ok: true };
  }
  const eventId = `evt_${cryptoRandom(8)}`;
  syncHost.eventLog.push({
    seq: game.sequence,
    eventId,
    action: action || "SYNC",
    actorId: actorId || "system",
    requestId: requestId || "",
    result: clone(result),
    timestamp: Date.now()
  });
  trimEventLog();
  broadcastStateEvent({
    type: "STATE_EVENT",
    seq: game.sequence,
    eventId,
    action: action || "SYNC",
    actorId: actorId || "system",
    requestId: requestId || "",
    result,
    room: publicRoom()
  }, actorId || "");
  syncClient.lastAppliedSeq = game.sequence;
}

function broadcastStateEvent(event, actorId) {
  if (!room.isHost) return;
  room.members.forEach(member => {
    if (member.id === room.myId || !member.connected || member.isBot) return;
    const sent = room.transport?.sendToPlayer(member.id, {
      type: "STATE_EVENT",
      seq: event.seq,
      eventId: event.eventId,
      action: event.action,
      actorId: event.actorId,
      requestId: member.id === actorId ? event.requestId : "",
      result: event.result,
      room: event.room,
      game: publicGameFor(member.id)
    });
    if (sent === false) {
      console.warn("[SYNC] STATE_EVENT 发送失败，等待周期检查补发", { memberId: member.id, seq: event.seq });
    }
  });
  try { render(); } catch (e) { console.error("[RENDER]", e); }
  scheduleBotAction();
  schedulePeriodicSyncCheck();
}

function handleEventRequest(memberId, fromSeq, toSeq) {
  if (!room.isHost || !game) return;
  const available = syncHost.eventLog.filter(e => e.seq >= fromSeq && e.seq <= toSeq);
  if (available.length === toSeq - fromSeq + 1) {
    available.forEach(evt => {
      room.transport?.sendToPlayer(memberId, {
        type: "STATE_EVENT",
        seq: evt.seq,
        eventId: evt.eventId,
        action: evt.action,
        actorId: evt.actorId,
        requestId: memberId === evt.actorId ? evt.requestId : "",
        result: evt.result,
        room: publicRoom(),
        game: publicGameFor(memberId)
      });
    });
  } else {
    sendSnapshot(memberId);
  }
}

function sendSnapshot(memberId, extra = {}) {
  if (!room.isHost) return false;
  const sent = room.transport?.sendToPlayer(memberId, {
    type: "SNAPSHOT",
    seq: game?.sequence ?? 0,
    room: publicRoom(),
    game: publicGameFor(memberId),
    chatHistory: ui.chatMessages.slice(-CHAT_MAX_MESSAGES),
    ...extra
  });
  if (sent === false) {
    console.warn("[SYNC] SNAPSHOT 发送失败", { memberId });
  }
  return sent || false;
}

function handleStateAck(memberId, seq) {
  syncHost.clientAcks.set(memberId, seq);
}

function schedulePeriodicSyncCheck() {
  if (ui.hostPeriodicTimer) return;
  if (!room.isHost || !game) return;
  ui.hostPeriodicTimer = setTimeout(() => {
    ui.hostPeriodicTimer = null;
    if (!room.isHost || !game) return;
    checkAIControl();
    const currentSeq = game.sequence;
    room.members.forEach(member => {
      if (member.id === room.myId || !member.connected || member.isBot) return;
      const ackedSeq = syncHost.clientAcks.get(member.id) ?? 0;
      if (ackedSeq < currentSeq) {
        const oldestInLog = syncHost.eventLog[0]?.seq ?? currentSeq + 1;
        if (ackedSeq + 1 >= oldestInLog) {
          handleEventRequest(member.id, ackedSeq + 1, currentSeq);
        } else {
          sendSnapshot(member.id);
        }
      }
    });
    schedulePeriodicSyncCheck();
  }, 5000);
}

// --- Client-side sync functions ---

function receiveStateEvent(event) {
  if (event.seq <= syncClient.lastAppliedSeq) return;
  syncClient.pendingEvents.set(event.seq, event);
  processSyncQueue();
}

function processSyncQueue() {
  let applied = false;
  while (true) {
    const nextSeq = syncClient.lastAppliedSeq + 1;
    const event = syncClient.pendingEvents.get(nextSeq);
    if (!event) break;
    syncClient.pendingEvents.delete(nextSeq);
    if (event.room) applyRoomSnapshot(event.room);
    if (event.game) game = event.game;
    if (event.requestId) {
      clearPendingGameAction(event.requestId);
    }
    if (ui.pendingAction && event.seq > ui.pendingAction.baseSequence) {
      clearPendingGameAction();
    }
    if (event.result?.draw?.kind === "event") {
      showToast(`摸到事件牌「${event.result.draw.name}」，已立即结算。`);
    } else if (event.result && !event.result.ok && event.result.reason) {
      showToast(event.result.reason);
    }
    syncClient.lastAppliedSeq = nextSeq;
    sendStateAck(nextSeq);
    applied = true;
  }
  if (syncClient.pendingEvents.size > 0 && !syncClient.gapRequest) {
    const nextExpected = syncClient.lastAppliedSeq + 1;
    const nextReceived = Math.min(...syncClient.pendingEvents.keys());
    if (nextReceived > nextExpected) {
      requestMissingEvents(nextExpected, nextReceived - 1);
    }
  }
  if (applied) {
    scheduleStateCheck();
    render();
  }
}

function requestMissingEvents(fromSeq, toSeq) {
  if (syncClient.gapRequest) return;
  syncClient.gapRequest = { fromSeq, toSeq };
  if (!room.isHost && room.connected) {
    room.transport?.sendToHost({ type: "EVENT_REQUEST", fromSeq, toSeq });
  }
  clearTimeout(ui.gapTimer);
  ui.gapTimer = setTimeout(() => {
    syncClient.gapRequest = null;
    if (!room.isHost && room.connected) {
      room.transport?.sendToHost({
        type: "SNAPSHOT_REQUEST",
        knownSeq: syncClient.lastAppliedSeq
      });
    }
  }, SYNC_GAP_TIMEOUT_MS);
}

function receiveSnapshot(snapshot) {
  if (snapshot.seq < syncClient.lastAppliedSeq) return;
  syncClient.pendingEvents.clear();
  clearTimeout(ui.gapTimer);
  syncClient.gapRequest = null;
  if (snapshot.room) applyRoomSnapshot(snapshot.room);
  if (snapshot.game) game = snapshot.game;
  if (Array.isArray(snapshot.chatHistory)) {
    ui.chatMessages = snapshot.chatHistory.slice(-CHAT_MAX_MESSAGES);
  }
  syncClient.lastAppliedSeq = snapshot.seq;
  clearPendingGameAction();
  processSyncQueue();
  scheduleStateCheck();
  render();
}

function sendStateAck(seq) {
  if (seq <= syncClient.lastAckSent) return;
  syncClient.lastAckSent = seq;
  if (!room.isHost && room.connected) {
    room.transport?.sendToHost({ type: "STATE_ACK", seq });
  }
}

function clearPendingEvents(initialSeq = 0) {
  syncClient.pendingEvents.clear();
  syncClient.lastAppliedSeq = initialSeq;
  syncClient.gapRequest = null;
  syncClient.lastAckSent = initialSeq;
  clearTimeout(ui.gapTimer);
  ui.gapTimer = null;
}

function scheduleStateCheck() {
  clearTimeout(ui.syncTimer);
  ui.syncTimer = null;
  if (room.isHost || !room.connected) return;
  ui.syncTimer = setTimeout(() => {
    if (!room.isHost && room.connected) {
      room.transport?.sendToHost({
        type: "SNAPSHOT_REQUEST",
        knownSeq: syncClient.lastAppliedSeq
      });
    }
    scheduleStateCheck();
  }, 5000);
}

function clearPendingGameAction(requestId = "") {
  if (requestId && ui.pendingAction?.requestId !== requestId) return;
  clearTimeout(ui.pendingActionTimer);
  ui.pendingActionTimer = null;
  ui.pendingAction = null;
  ui.pendingRequest = false;
}

function broadcastLobby() {
  if (!room.isHost) return;
  room.transport?.broadcast({ type: "ROOM_SYNC", room: publicRoom() });
  render();
}

function handleJoin(message, meta) {
  if (!room.isHost || message.roomCode !== room.code) return;
  const safeName = String(message.name || "玩家").trim().slice(0, 16) || "玩家";
  room.transport.bindPlayer(meta.peerId, message.playerId, safeName);
  let member = room.members.find(item => item.id === message.playerId);
  const wasDisconnected = !!member && !member.connected;
  if (member) {
    member.connected = true;
    member.disconnectedAt = 0;
    member.name = safeName;
    member.peerId = meta.peerId;
    syncHost.clientAcks.delete(member.id);
  } else {
    const spectator = room.lifecycle === ROOM_STATE.PLAYING ||
      room.lifecycle === ROOM_STATE.SETTLEMENT;
    member = {
      id: message.playerId,
      name: safeName,
      isHost: false,
      connected: true,
      spectator,
      peerId: meta.peerId
    };
    room.members.push(member);
  }
  if (game) {
    const player = game.players.find(item => item.memberId === member.id);
    if (player) {
      if (player.aiControlled) {
        member.spectator = true;
        pushSystemChat(`${member.name} 已进入 AI 托管，以观战身份重连。`);
      } else {
        // 检查重连时间是否在 90 秒内
        const now = Date.now();
        const within90 = !player.disconnectedAt || (now - player.disconnectedAt < DISCONNECT_AI_TIMEOUT_MS);
        if (within90) {
          player.connected = true;
          player.disconnectedAt = 0;
          member.spectator = false;
        } else {
          // 超过 90 秒，以观战身份进入，AI 继续托管
          player.aiControlled = true;
          member.spectator = true;
          pushSystemChat(`${member.name} 断线超过 90 秒重连，以观战身份进入（AI 托管中）。`);
          appendLog(`${player.name} 断线超过 90 秒重连，AI 永久接管。`, "event");
        }
      }
    }
  }
  sendSnapshot(member.id);
  pushSystemChat(wasDisconnected ? `${member.name} 已重连。` : `${member.name} 加入了房间。`);
  if (room.lifecycle === ROOM_STATE.WAITING) broadcastLobby();
  else commitGameState("SYNC", "system", "", null);
}

function handleNetworkMessage(message, meta = {}) {
  if (!message || !message.type) return;
  if (message.type === "JOIN") {
    handleJoin(message, meta);
    return;
  }
  if (message.type === "SNAPSHOT") {
    room.connected = true;
    receiveSnapshot(message);
    startHeartbeat();
    if (ui.joinResolver) {
      ui.joinResolver(ok());
      ui.joinResolver = null;
    }
    render();
    return;
  }
  if (message.type === "REJECT") {
    if (ui.joinResolver) {
      ui.joinResolver(fail(message.reason || "无法加入房间"));
      ui.joinResolver = null;
    }
    return;
  }
  if (message.type === "ROOM_SYNC") {
    applyRoomSnapshot(message.room);
    render();
    return;
  }
  if (message.type === "STATE_EVENT") {
    receiveStateEvent(message);
    return;
  }
  if (message.type === "EVENT_REQUEST" && room.isHost) {
    handleEventRequest(meta.playerId, Number(message.fromSeq), Number(message.toSeq));
    return;
  }
  if (message.type === "ROOM_ACTION" && room.isHost) {
    handleRoomAction(meta.playerId, message.action, message.payload || {});
    return;
  }
  if (message.type === "ACTION_REQUEST" && room.isHost) {
    const requestId = String(message.requestId || "").slice(0, 96);
    const actionKey = requestId ? `${meta.playerId}:${requestId}` : "";
    if (actionKey && processedGameActions.has(actionKey)) {
      sendSnapshot(meta.playerId);
      return;
    }
    const result = hostDispatch(
      meta.playerId,
      message.action,
      message.payload || {},
      requestId
    );
    if (actionKey) processedGameActions.set(actionKey, { ...result, sequence: game?.sequence || 0 });
    while (processedGameActions.size > 200) {
      processedGameActions.delete(processedGameActions.keys().next().value);
    }
    if (!result.ok && requestId) {
      room.transport?.sendToPlayer(meta.playerId, {
        type: "STATE_EVENT",
        seq: game?.sequence ?? 0,
        eventId: `evt_${cryptoRandom(8)}`,
        action: message.action,
        actorId: meta.playerId,
        requestId,
        result,
        room: publicRoom(),
        game: publicGameFor(meta.playerId)
      });
    }
    return;
  }
  if (message.type === "SNAPSHOT_REQUEST" && room.isHost) {
    const knownSeq = Number(message.knownSeq);
    if (!Number.isSafeInteger(knownSeq) || knownSeq < (game?.sequence ?? 0)) {
      sendSnapshot(meta.playerId);
    }
    return;
  }
  if (message.type === "STATE_ACK" && room.isHost) {
    handleStateAck(meta.playerId, Number(message.seq));
    return;
  }
  if (message.type === "HOST_MOVING") {
    scheduleGracefulMigration(message.nextHostId);
    return;
  }
  if (message.type === "PROMOTE") {
    promoteToHost(message.room, message.gameBackup);
    return;
  }
  if (message.type === "CHAT" && room.isHost) {
    handleChatMessage(meta.playerId, message);
    return;
  }
  if (message.type === "CHAT_BROADCAST") {
    receiveChatBroadcast(message.message);
    return;
  }
  if (message.type === "HEARTBEAT" && room.isHost) {
    room.transport?.sendToPlayer(meta.playerId, { type: "HEARTBEAT_ACK" });
    return;
  }
  if (message.type === "HEARTBEAT_ACK") {
    ui.heartbeatMisses = 0;
    return;
  }
  if (message.type === "MUTE_UPDATE" && room.isHost) {
    handleMuteUpdate(meta.playerId, message);
    return;
  }
  if (message.type === "MUTE_NOTICE") {
    if (message.muted) ui.mutedPlayerIds.add(message.playerId);
    else ui.mutedPlayerIds.delete(message.playerId);
    render();
    return;
  }
}

function filterChatContent(text) {
  let filtered = String(text || "");
  SENSITIVE_WORDS.forEach(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filtered = filtered.replace(new RegExp(escaped, "gi"), "*".repeat(word.length));
  });
  return filtered;
}

function loadBlockedPlayers() {
  try {
    const stored = localStorage.getItem(BLOCKED_PLAYER_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch (_) {}
  return new Set();
}

function saveBlockedPlayers(set) {
  try { localStorage.setItem(BLOCKED_PLAYER_KEY, JSON.stringify([...set])); } catch (_) {}
}

function isPlayerBlocked(playerId) {
  if (!ui.blockedPlayerIds) ui.blockedPlayerIds = loadBlockedPlayers();
  return ui.blockedPlayerIds.has(playerId);
}

function toggleBlockPlayer(playerId) {
  if (!ui.blockedPlayerIds) ui.blockedPlayerIds = loadBlockedPlayers();
  if (ui.blockedPlayerIds.has(playerId)) ui.blockedPlayerIds.delete(playerId);
  else ui.blockedPlayerIds.add(playerId);
  saveBlockedPlayers(ui.blockedPlayerIds);
  render();
}

function addChatMessage(message) {
  ui.chatMessages.push(message);
  while (ui.chatMessages.length > CHAT_MAX_MESSAGES) ui.chatMessages.shift();
}

function pushSystemChat(text) {
  const msg = { type: "system", text, timestamp: Date.now() };
  addChatMessage(msg);
  if (room.isHost && room.connected) {
    broadcastChat(msg);
  }
  render();
}

function handleChatMessage(senderId, message) {
  if (!room.isHost) return;
  const sender = room.members.find(m => m.id === senderId);
  if (!sender) return;
  if (ui.mutedPlayerIds.has(senderId)) {
    room.transport?.sendToPlayer(senderId, {
      type: "MUTE_NOTICE",
      playerId: senderId,
      muted: true
    });
    return;
  }
  const content = filterChatContent(String(message.content || "").slice(0, CHAT_MAX_LENGTH).trim());
  if (!content) return;
  const chatMsg = {
    type: "chat",
    senderId,
    senderName: sender.name,
    isSpectator: sender.spectator,
    content,
    timestamp: Date.now()
  };
  addChatMessage(chatMsg);
  broadcastChat(chatMsg);
  render();
}

function broadcastChat(chatMsg) {
  const payload = { type: "CHAT_BROADCAST", message: chatMsg };
  room.members.forEach(member => {
    if (member.id === room.myId || !member.connected || member.isBot) return;
    room.transport?.sendToPlayer(member.id, payload);
  });
}

function receiveChatBroadcast(chatMsg) {
  addChatMessage(chatMsg);
  render();
}

function sendChat(text) {
  const now = Date.now();
  if (now - ui.chatLastSent < CHAT_RATE_LIMIT_MS) {
    showToast("发言过快，请稍候");
    return;
  }
  const content = filterChatContent(String(text || "").slice(0, CHAT_MAX_LENGTH).trim());
  if (!content) return;
  ui.chatLastSent = now;
  if (room.isHost) {
    const chatMsg = {
      type: "chat",
      senderId: room.myId,
      senderName: room.myName,
      isSpectator: room.members.find(m => m.id === room.myId)?.spectator || false,
      content,
      timestamp: now
    };
    addChatMessage(chatMsg);
    broadcastChat(chatMsg);
    render();
  } else {
    room.transport?.sendToHost({ type: "CHAT", content });
  }
}

function handleMuteUpdate(actorId, message) {
  if (!room.isHost || actorId !== room.hostId) return;
  const targetId = String(message.playerId || "").slice(0, 64);
  if (!targetId) return;
  if (message.muted) ui.mutedPlayerIds.add(targetId);
  else ui.mutedPlayerIds.delete(targetId);
  room.transport?.sendToPlayer(targetId, {
    type: "MUTE_NOTICE",
    playerId: targetId,
    muted: message.muted
  });
  const target = room.members.find(m => m.id === targetId);
  pushSystemChat(`${message.muted ? "禁言" : "解除禁言"}：${target?.name || targetId}`);
}

function toggleMute(playerId) {
  if (!room.isHost) return;
  const muted = ui.mutedPlayerIds.has(playerId);
  room.transport?.sendToHost({
    type: "MUTE_UPDATE",
    playerId,
    muted: !muted
  });
}

function startHeartbeat() {
  stopHeartbeat();
  if (room.isHost) return;
  ui.heartbeatMisses = 0;
  ui.heartbeatTimer = setTimeout(function beat() {
    if (!room.connected || room.isHost) return;
    ui.heartbeatMisses++;
    if (ui.heartbeatMisses >= 3) {
      ui.heartbeatMisses = 0;
      handleUnexpectedHostLoss();
      return;
    }
    room.transport?.sendToHost({ type: "HEARTBEAT" });
    ui.heartbeatTimer = setTimeout(beat, 5000);
  }, 5000);
}

function stopHeartbeat() {
  if (ui.heartbeatTimer) {
    clearTimeout(ui.heartbeatTimer);
    ui.heartbeatTimer = null;
  }
  ui.heartbeatMisses = 0;
}

function handleRoomAction(memberId, action, payload) {
  if (!room.isHost) return;
  const member = room.members.find(item => item.id === memberId);
  if (!member) return;
  if (action === "UPDATE_ROUNDS" && memberId === room.hostId && room.lifecycle === ROOM_STATE.WAITING) {
    const rounds = Number(payload.totalRounds);
    if (Number.isSafeInteger(rounds) && rounds > 0) {
      room.settings.totalRounds = rounds;
      broadcastLobby();
    }
  } else if (action === "START" && memberId === room.hostId) {
    startGame();
  } else if (action === "BACK_TO_LOBBY" && memberId === room.hostId && room.lifecycle === ROOM_STATE.SETTLEMENT) {
    resetToLobby();
  } else if (action === "LEAVE") {
    markMemberDisconnected(memberId, true);
  } else if (action === "ADD_BOT" && memberId === room.hostId && room.lifecycle === ROOM_STATE.WAITING) {
    const connectedRealPlayers = room.members.filter(m => m.connected && !m.spectator && !m.isBot).length;
    const existingBots = room.members.filter(m => m.isBot).length;
    if (connectedRealPlayers + existingBots >= 8) return showToast("房间人数已达上限");
    const difficulty = payload.difficulty === "normal" ? "normal" : "simple";
    const botNames = ["机器人A", "机器人B", "机器人C", "机器人D"];
    const usedNames = new Set(room.members.map(m => m.name));
    const botName = botNames.find(n => !usedNames.has(n)) || ("机器人" + (existingBots + 1));
    const botMember = {
      id: "bot_" + cryptoRandom(8),
      name: botName,
      isHost: false,
      connected: true,
      spectator: false,
      peerId: null,
      isBot: true,
      difficulty
    };
    room.members.push(botMember);
    pushSystemChat(`机器人「${botName}」(${difficulty === "normal" ? "普通" : "简单"})已加入房间。`);
    broadcastLobby();
  } else if (action === "REMOVE_BOT" && memberId === room.hostId && room.lifecycle === ROOM_STATE.WAITING) {
    const botId = String(payload.botId || "");
    const bot = room.members.find(m => m.id === botId && m.isBot);
    if (!bot) return;
    room.members = room.members.filter(m => m.id !== botId);
    pushSystemChat(`机器人「${bot.name}」已移出房间。`);
    broadcastLobby();
  } else if (action === "TRANSFER_HOST" && memberId === room.hostId) {
    transferHost(String(payload.targetMemberId || ""));
  }
}

function sendRoomAction(action, payload = {}) {
  if (room.isHost) handleRoomAction(room.myId, action, payload);
  else room.transport?.sendToHost({ type: "ROOM_ACTION", action, payload });
}

function sendGameAction(action, payload = {}) {
  if (ui.pendingRequest) return;
  if (room.isHost) {
    const result = hostDispatch(room.myId, action, payload);
    if (!result.ok) showToast(result.reason);
    render();
    return;
  }
  const requestId = `${room.myId}-${Date.now()}-${cryptoRandom(4)}`;
  ui.pendingRequest = true;
  ui.pendingAction = {
    requestId,
    action,
    payload: clone(payload),
    attempts: 0,
    baseSequence: game?.sequence ?? -1
  };
  const sent = room.transport?.sendToHost({
    type: "ACTION_REQUEST",
    requestId,
    action,
    payload: clone(payload)
  });
  if (!sent) {
    clearPendingGameAction();
    showToast("连接暂不可用，请等待重连后重试");
    render();
    return;
  }
  clearTimeout(ui.pendingActionTimer);
  ui.pendingActionTimer = setTimeout(function retryAction() {
    if (!ui.pendingAction) return;
    if (ui.pendingAction.attempts >= 3) {
      clearPendingGameAction(ui.pendingAction.requestId);
      room.transport?.sendToHost({
        type: "SNAPSHOT_REQUEST",
        knownSeq: syncClient.lastAppliedSeq
      });
      showToast("操作确认超时，已重新同步，请确认状态后重试");
      render();
      return;
    }
    ui.pendingAction.attempts++;
    room.transport?.sendToHost({
      type: "ACTION_REQUEST",
      requestId: ui.pendingAction.requestId,
      action: ui.pendingAction.action,
      payload: ui.pendingAction.payload
    });
    clearTimeout(ui.pendingActionTimer);
    ui.pendingActionTimer = setTimeout(retryAction, 3000);
  }, 3000);
  render();
}

function markMemberDisconnected(memberId, voluntary = false) {
  const member = room.members.find(item => item.id === memberId);
  if (!member || member.id === room.hostId) return;
  if (voluntary && (room.lifecycle === ROOM_STATE.WAITING || member.spectator)) {
    room.members = room.members.filter(item => item.id !== memberId);
    syncHost.clientAcks.delete(memberId);
    if (room.isHost) pushSystemChat(`${member.name} 离开了房间。`);
    if (game) commitGameState("SYNC", "system", "", null);
    else broadcastLobby();
    return;
  }
  member.connected = false;
  member.disconnectedAt = Date.now();
  syncHost.clientAcks.delete(memberId);
  const player = game?.players.find(item => item.memberId === memberId);
  if (player) {
    player.connected = false;
    player.disconnectedAt = Date.now();
  }
  if (room.isHost) pushSystemChat(`${member.name} 断线了，正在等待重连…`);
  if (game) commitGameState("SYNC", "system", "", null);
  else broadcastLobby();
}

async function createRoom(name) {
  ui.busy = true;
  ui.message = "正在创建房间...";
  ui.messageError = false;
  render();
  const code = cryptoRandom(5);
  try {
    const transport = new PeerTransport(code);
    installTransport(transport);
    await transport.startHost();
    room.connected = true;
    room.code = code;
    room.myName = name;
    room.hostId = room.myId;
    room.isHost = true;
    room.lifecycle = ROOM_STATE.WAITING;
    room.settings = { totalRounds: 10 };
    saveRoomSession(code, name);
    room.members = [{
      id: room.myId,
      name,
      isHost: true,
      connected: true,
      spectator: false,
      peerId: transport.myPeerId
    }];
    room.transport = transport;
    ui.screen = "lobby";
    ui.message = "";
  } catch (error) {
    room.transport?.close();
    room.transport = null;
    ui.message = friendlyConnectionError(error);
    ui.messageError = true;
  } finally {
    ui.busy = false;
    render();
  }
}

async function joinRoom(name, code, reconnect = false) {
  if (!reconnect) {
    ui.busy = true;
    ui.message = `正在加入房间 ${code}...`;
    ui.messageError = false;
    render();
  }
  try {
    const transport = new PeerTransport(code);
    installTransport(transport);
    await transport.startClient();
    room.transport = transport;
    room.code = code;
    room.myName = name;
    const joined = new Promise(resolve => {
      ui.joinResolver = resolve;
      setTimeout(() => {
        if (ui.joinResolver) {
          ui.joinResolver(fail("房间无响应，请确认房主在线后重试"));
          ui.joinResolver = null;
        }
      }, 30000);
    });
    transport.sendToHost({ type: "JOIN", roomCode: code, playerId: room.myId, name, reconnect });
    const result = await joined;
    if (!result.ok) throw new Error(result.reason);
    room.connected = true;
    saveRoomSession(code, name);
    startHeartbeat();
    ui.message = "";
    ui.messageError = false;
  } catch (error) {
    room.transport?.close();
    room.transport = null;
    room.connected = false;
    if (!reconnect) {
      ui.screen = "entry";
      ui.message = friendlyConnectionError(error);
      ui.messageError = true;
    } else {
      ui.message = "重连失败，请返回首页后重新加入。";
      ui.messageError = true;
    }
  } finally {
    ui.busy = false;
    render();
  }
}

function installTransport(transport) {
  room.transport = transport;
  transport.onMessage = handleNetworkMessage;
  transport.onPeerLeft = meta => {
    if (room.isHost && meta.playerId) markMemberDisconnected(meta.playerId);
  };
  transport.onHostLost = () => handleUnexpectedHostLoss();
}

function friendlyConnectionError(error) {
  const message = String(error?.message || error || "连接失败");
  if (message.includes("unavailable-id")) return "该房间码已被占用，请重试。";
  if (message.includes("peer-unavailable")) return "房间不存在或房主尚未就绪。";
  if (message.includes("PeerJS")) return "联机组件加载失败，请检查网络后刷新。";
  if (message.includes("timeout") || message.includes("超时") || message.includes("无响应")) return "连接房主超时，请确认房间码正确、房主在线，并检查网络后重试。";
  return message;
}

function handleUnexpectedHostLoss() {
  if (room.isHost || !room.connected) return;
  ui.hostLostAt = Date.now();
  ui.message = "房主连接中断，30秒后尝试转移房主。";
  render();
  clearTimeout(ui.migrationTimer);
  const candidates = room.members.filter(member => member.id !== room.hostId && member.connected && !member.spectator);
  const nextHost = candidates[0];
  if (!nextHost) return;
  const delay = nextHost.id === room.myId ? 30000 : 33500;
  ui.migrationTimer = setTimeout(() => {
    if (nextHost.id === room.myId) {
      const snapshot = publicRoom();
      snapshot.hostId = room.myId;
      snapshot.members = snapshot.members.map(member => ({
        ...member,
        isHost: member.id === room.myId,
        connected: member.id === room.hostId ? false : member.connected
      }));
      promoteToHost(snapshot, game);
    } else {
      reconnectToCurrentHost();
    }
  }, delay);
}

function scheduleGracefulMigration(nextHostId) {
  clearTimeout(ui.migrationTimer);
  ui.message = "房主正在转移，稍后自动重连。";
  render();
  if (nextHostId !== room.myId) ui.migrationTimer = setTimeout(reconnectToCurrentHost, 1800);
}

async function promoteToHost(roomSnapshot, gameBackup) {
  try {
    room.transport?.close();
    await new Promise(resolve => setTimeout(resolve, 700));
    applyRoomSnapshot(roomSnapshot);
    room.hostId = room.myId;
    room.isHost = true;
    room.members = room.members.map(member => ({ ...member, isHost: member.id === room.myId }));
    game = gameBackup || game;
    const transport = new PeerTransport(room.code);
    installTransport(transport);
    await transport.startHost();
    room.transport = transport;
    room.connected = true;
    ui.message = "";
    stopHeartbeat();
    clearPendingEvents(game?.sequence ?? 0);
    syncHost.eventLog = [];
    syncHost.clientAcks.clear();
    if (game) {
      const previousHost = game.players.find(player => player.memberId !== room.myId && !room.members.find(member => member.id === player.memberId)?.connected);
      if (previousHost) {
        previousHost.connected = false;
        previousHost.disconnectedAt = Date.now();
      }
    }
    if (game) commitGameState("SYNC", "system", "", null);
  } catch (error) {
    room.isHost = false;
    ui.message = "房主转移失败，正在尝试恢复连接。";
    render();
    setTimeout(reconnectToCurrentHost, 1200);
  }
}

function reconnectToCurrentHost() {
  room.transport?.close();
  joinRoom(room.myName, room.code, true);
}

function leaveRoom() {
  if (!room.connected) return resetClient();
  if (room.isHost) {
    const next = room.members.find(member => member.id !== room.myId && member.connected && !member.spectator);
    if (next) {
      const snapshot = publicRoom();
      snapshot.hostId = next.id;
      snapshot.members = snapshot.members.map(member => ({
        ...member,
        isHost: member.id === next.id,
        connected: member.id === room.myId ? false : member.connected
      }));
      room.transport.sendToPlayer(next.id, { type: "PROMOTE", room: snapshot, gameBackup: game });
      room.transport.broadcast({ type: "HOST_MOVING", nextHostId: next.id });
      setTimeout(resetClient, 350);
      return;
    }
  } else {
    room.transport?.sendToHost({ type: "ROOM_ACTION", action: "LEAVE", payload: {} });
  }
  resetClient();
}

function transferHost(targetMemberId) {
  if (!room.isHost) return;
  const target = room.members.find(m => m.id === targetMemberId && m.connected && !m.spectator && !m.isBot && m.id !== room.myId);
  if (!target) return showToast("该成员无法成为房主");
  const snapshot = publicRoom();
  snapshot.hostId = target.id;
  snapshot.members = snapshot.members.map(member => ({
    ...member,
    isHost: member.id === target.id
  }));
  pushSystemChat(`房主已转让给「${target.name}」。`);
  room.transport.sendToPlayer(target.id, { type: "PROMOTE", room: snapshot, gameBackup: game });
  room.transport.broadcast({ type: "HOST_MOVING", nextHostId: target.id });
  room.hostId = target.id;
  room.isHost = false;
  ui.message = "房主转让中，正在重连…";
  clearTimeout(ui.hostPeriodicTimer);
  ui.hostPeriodicTimer = null;
  render();
  setTimeout(() => {
    room.transport?.close();
    room.transport = null;
    setTimeout(reconnectToCurrentHost, 1500);
  }, 350);
}

function resetClient() {
  clearTimeout(ui.migrationTimer);
  clearTimeout(ui.syncTimer);
  clearTimeout(ui.hostPeriodicTimer);
  stopHeartbeat();
  ui.syncTimer = null;
  ui.hostPeriodicTimer = null;
  clearPendingEvents(0);
  ui.chatMessages = [];
  ui.mutedPlayerIds.clear();
  clearRoomSession();
  clearPendingGameAction();
  room.transport?.close();
  room.connected = false;
  room.code = "";
  room.hostId = "";
  room.isHost = false;
  room.lifecycle = ROOM_STATE.WAITING;
  room.members = [];
  room.transport = null;
  game = null;
  ui.screen = "entry";
  ui.modal = null;
  ui.message = "";
  render();
}
