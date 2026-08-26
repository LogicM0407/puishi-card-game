"use strict";

function icon(name, size = 16) {
  return `<i data-lucide="${name}" style="width:${size}px;height:${size}px" aria-hidden="true"></i>`;
}

function initIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function setMessage(text, error = false) {
  ui.message = text;
  ui.messageError = error;
  render();
}

function showToast(text) {
  ui.toast = text;
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => {
    ui.toast = "";
    render();
  }, 2400);
}

function appendLog(text, type = "normal") {
  if (!game) return;
  game.log.push({ round: game.round || 0, text, type });
  if (game.log.length > 120) game.log.shift();
}

function render() {
  // 清理已失效的七迹弹窗（轮到他人或七迹已结束）
  if (ui.modal?.kind === "seven-trace" && (!game?.sevenTrace || game.sevenTrace.responderMemberId !== room.myId)) {
    ui.modal = null;
  }
  // 星抵消确认
  if (!ui.modal && game?.pendingStarMitigation && game.pendingStarMitigation.memberId === room.myId && !isSpectator()) {
    const me = myGamePlayer();
    const pending = game.pendingStarMitigation;
    const total = pending.reductions.reduce((s, r) => s + r.amount, 0);
    const starCount = (me?.hand || []).filter(c => c.type === "star").length;
    ui.modal = {
      kind: "star-mitigation",
      title: "抵消减分",
      description: `你受到 ${total} 点减分。是否弃置【星】抵消？每8点具象动效抵消1点减分（当前具象 ${me?.scores?.concrete ?? 0}，持有 ${starCount} 张星）。`,
      total
    };
  }
  // 若有待处理事件且当前我是响应者，且没有其他modal，自动弹出事件处理窗口
  if (!ui.modal && game?.pendingEvent && game.pendingEvent.responderMemberId === room.myId && !isSpectator()) {
    const pending = game.pendingEvent;
    const event = eventDefinition(pending.eventId);
    if (pending.stage === "choose") {
      const me = myGamePlayer();
      const isMaimai = pending.eventId === "maimai";
      ui.modal = {
        kind: "event-choose",
        title: `事件：${event.name}`,
        description: isMaimai
          ? event.description + "（请选择另一位玩家。）"
          : event.description + "（请选择自己的1名角色和另一位玩家。注：技能被禁用的角色也可参与拼机）",
        requiresOwnCharacter: !isMaimai,
        ownCharacters: me?.characters || [],
        targets: game.players.filter(p => p.memberId !== me?.memberId),
        selectedCharacterUid: null,
        selectedTargetMemberId: null
      };
    } else if (pending.stage === "response") {
      const actor = game.players[pending.actorIndex];
      const targetPlayer = game.players[pending.targetPlayerIndex];
      const mustAccept = pending.eventId === "maimai";
      ui.modal = {
        kind: "event-response",
        title: `事件响应：${event.name}`,
        description: mustAccept
          ? `${actor.name} 邀请你一起「${event.name}」，必须参与。请选择自己的1名角色（技能被禁用的角色也可参与）。`
          : `${actor.name} 邀请你一起「${event.name}」。同意时选择1名角色拼机（技能被禁用的角色也可参与）；拒绝时发起者声望-5但获得能力加成。`,
        mustAccept,
        myCharacters: targetPlayer?.characters || [],
        selectedCharacterUid: null,
        decision: mustAccept ? "accept" : null
      };
    }
  }
  // 算数教室弹窗
  if (!ui.modal && game?.arithmetic && !isSpectator()) {
    const meIndex = game.players.findIndex(p => p.memberId === room.myId);
    if (game.arithmetic.playerIndex === meIndex) {
      const timeLimit = game.arithmetic.medium ? 15000 : 5000;
      ui.modal = {
        kind: "arithmetic",
        title: "算数教室",
        description: game.arithmetic.medium
          ? "中等难度：15秒内选出答案正确的选项"
          : "5秒内选出答案正确的选项",
        questions: game.arithmetic.questions
      };
      clearTimeout(ui.arithmeticTimer);
      ui.arithmeticTimer = setTimeout(() => {
        if (ui.modal?.kind === "arithmetic") {
          ui.modal = null;
          sendGameAction("ANSWER_ARITHMETIC", { selectedIndex: -1 });
        }
      }, timeLimit);
    }
  }
  // 七迹选牌弹窗
  if (!ui.modal && game?.sevenTrace && game.sevenTrace.responderMemberId === room.myId && !isSpectator()) {
    ui.modal = {
      kind: "seven-trace",
      title: "七迹 · 选牌",
      description: `从窗口中选1张牌加入手牌（剩余 ${game.sevenTrace.cards.length} 张）。15秒未选择将自动随机分配。`,
      cards: game.sevenTrace.cards
    };
  }
  if (ui.screen === "entry" || !room.connected) renderEntry();
  else if (room.lifecycle === ROOM_STATE.WAITING) renderLobby();
  else if (room.lifecycle === ROOM_STATE.SETTLEMENT || game?.phase === GAME_PHASE.SETTLEMENT) renderSettlement();
  else renderGame();
  if (ui.toast) app.insertAdjacentHTML("beforeend", `<div class="toast" role="status">${escapeHtml(ui.toast)}</div>`);
  if (ui.rulesOpen) renderRulesModal();
  if (ui.modal) renderActionModal();
  if (ui.hostLostAt && !room.isHost && room.connected) {
    app.insertAdjacentHTML("beforeend", `<div class="connection-warning">${escapeHtml(ui.message || "连接中断，正在恢复。")}</div>`);
  }
  if (room.connected && ui.screen !== "entry") renderChatPanel();
  initIcons();
}

function renderEntry() {
  const creditsList = ["XerdouS", "Stic3r", "大黄金史莱姆", "zmh054", "中微子", "某轩呦", "duckshout", "白泽", "Ikigai", "O.K.", "1116", "SnowPainted"];
  const savedSession = loadRoomSession();
  app.innerHTML = `
    <div class="entry-shell">
      <div class="brand">
        <div class="brand-mark">${icon("music-2", 26)}</div>
        <div><h1>谱师卡牌</h1><div class="version">${VERSION}</div></div>
      </div>
      ${savedSession ? `
      <section class="entry-reconnect">
        <div class="reconnect-info">${icon("wifi", 16)} 检测到上次未结束的游戏（房间 ${escapeHtml(savedSession.roomCode)}）</div>
        <button class="btn primary full" id="reconnect-btn" ${ui.busy ? "disabled" : ""}>${icon("refresh-cw", 16)} 重新连接</button>
      </section>
      ` : ""}
      <section class="entry-form">
        <div class="mode-line">${icon("users", 18)} 房间</div>
        <div class="field">
          <label for="player-name">玩家名称</label>
          <input class="input" id="player-name" maxlength="16" autocomplete="nickname" placeholder="输入你的名称" value="${escapeHtml(savedSession?.playerName || room.myName)}">
        </div>
        <button class="btn primary full" id="create-room" ${ui.busy ? "disabled" : ""}>${icon("plus", 16)} 创建房间</button>
        <div class="divider">或加入房间</div>
        <div class="join-row">
          <input class="input room-code-input" id="join-code" maxlength="5" placeholder="房间码" autocomplete="off">
          <button class="btn" id="join-room" ${ui.busy ? "disabled" : ""}>${icon("log-in", 16)} 加入</button>
        </div>
        <div class="status-message ${ui.messageError ? "error" : ""}" role="status">${escapeHtml(ui.message)}</div>
        <div class="brief">房间人数大于1人即可开始。游戏开始后加入的成员只能观战，等本局结束后再加入玩家列表。</div>
      </section>
      <div class="entry-links">
        <a href="https://docs.qq.com/doc/DTHZndEh2RG1hTGJu?no_promotion=1&is_blank_or_template=blank" target="_blank" rel="noopener">
          ${icon("file-text", 14)} <span>共享开发文档</span>
          <span class="link-desc">— 查看介绍、发表建议、DIY卡牌</span>
        </a>
        <a href="https://docs.qq.com/form/page/DS1J6dmxtcGxIYWFS" target="_blank" rel="noopener">
          ${icon("bug", 14)} <span>Bug 反馈表</span>
          <span class="link-desc">— 发现Bug请填写收集表</span>
        </a>
        <a href="https://docs.qq.com/sheet/DS3VqeGNLc1dkamRT" target="_blank" rel="noopener">
          ${icon("clipboard-list", 14)} <span>工单处理结果</span>
          <span class="link-desc">— 查看Bug修复进度</span>
        </a>
      </div>
      <div class="entry-changelog">
        <div class="changelog-title">${icon("list", 12)} 更新日志</div>
        ${CHANGELOG.map(group => `<div class="changelog-group"><strong>${escapeHtml(group.version)}</strong><ul>${group.items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`).join("")}
      </div>
      <div class="entry-credits">
        <div class="credits-title">Credits</div>
        <div class="credits-list">${creditsList.join(" · ")}</div>
      </div>
      <div class="entry-dev">Developed by LogicM with TRAE AI</div>
    </div>`;
  const nameInput = document.getElementById("player-name");
  document.getElementById("create-room").onclick = () => {
    const name = nameInput.value.trim();
    if (!name) return setMessage("请输入玩家名称。", true);
    room.myName = name;
    createRoom(name);
  };
  document.getElementById("join-room").onclick = () => {
    const name = nameInput.value.trim();
    const code = document.getElementById("join-code").value.trim().toUpperCase();
    if (!name) return setMessage("请输入玩家名称。", true);
    if (!/^[A-Z2-9]{5}$/.test(code)) return setMessage("请输入5位房间码。", true);
    room.myName = name;
    joinRoom(name, code);
  };
  document.getElementById("join-code").onkeydown = event => {
    if (event.key === "Enter") document.getElementById("join-room").click();
  };
  const reconnectBtn = document.getElementById("reconnect-btn");
  if (reconnectBtn) reconnectBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) return setMessage("请输入玩家名称。", true);
    room.myName = name;
    joinRoom(name, savedSession.roomCode, true);
  };
}

function topbar(title, extra = "") {
  return `
    <header class="topbar">
      <div class="topbar-title">${escapeHtml(title)}</div>
      <span class="room-pill">${room.code}</span>
      ${extra}
      <span class="spacer"></span>
      <button class="btn icon-only small" id="rules-button" title="查看规则">${icon("book-open", 16)}</button>
      <button class="btn icon-only small danger" id="leave-button" title="离开房间">${icon("log-out", 16)}</button>
    </header>`;
}

function bindTopbar() {
  document.getElementById("rules-button").onclick = () => { ui.rulesOpen = true; render(); };
  document.getElementById("leave-button").onclick = leaveRoom;
}

function renderLobby() {
  const activePlayers = roomPlayers().filter(member => member.connected);
  const canStart = room.isHost &&
    activePlayers.length >= 2;
  app.innerHTML = `
    ${topbar("房间大厅", `<span class="state-pill">${room.lifecycle}</span>`)}
    <div class="room-layout">
      <div>
        <section class="section">
          <div class="section-note">房间码</div>
          <div class="lobby-code">${room.code}</div>
          <div class="lobby-sub">将房间码发给其他玩家。</div>
          <div class="lobby-actions">
            <button class="btn" id="copy-code">${icon("copy", 15)} 复制房间码</button>
            ${room.isHost
              ? `<button class="btn primary" id="start-game" ${canStart ? "" : "disabled"}>${icon("play", 15)} 开始游戏</button>`
              : ""}
          </div>
          <div class="status-message ${ui.messageError ? "error" : ""}">${escapeHtml(ui.message)}</div>
        </section>
        <section class="section">
          <div class="section-head"><h2>玩家列表</h2><span class="section-note">${activePlayers.length} 名玩家</span></div>
          <div class="member-list">${room.members.map(renderMemberRow).join("")}</div>
        </section>
      </div>
      <aside>
        <section class="section">
          <div class="section-head"><h2>房间设置</h2>${room.isHost ? '<span class="tag host">房主可改</span>' : ""}</div>
          <div class="setting-row">
            <div class="setting-label">总回合数<span>回合数可由玩家自行设置</span></div>
            <input class="input round-input" id="round-count" type="number" min="1" step="1" value="${room.settings.totalRounds}" ${room.isHost ? "" : "disabled"}>
          </div>
          <div class="setting-row">
            <div class="setting-label">初始购置点数<span>购置角色后进入第1轮</span></div>
            <strong>12</strong>
          </div>
          <div class="setting-row">
            <div class="setting-label">启用全局状态<span>开局时随机一种全局状态，整局生效（可选玩法）</span></div>
            <label class="checkbox-label"><input type="checkbox" id="global-state-toggle" ${room.settings.globalStateEnabled ? "checked" : ""} ${room.isHost ? "" : "disabled"}> 启用</label>
          </div>
        </section>
        <div class="notice">房间人数大于1人即可开始。游戏开始后新成员只能观战。</div>
        ${room.isHost && room.lifecycle === ROOM_STATE.WAITING ? `
        <section class="section">
          <div class="section-head"><h2>机器人</h2></div>
          <div class="bot-actions">
            <button class="btn" id="add-bot-simple">${icon("plus", 14)} 添加简单机器人</button>
            <button class="btn" id="add-bot-normal">${icon("plus", 14)} 添加普通机器人</button>
          </div>
        </section>
        ` : ""}
      </aside>
    </div>`;
  bindTopbar();
  document.getElementById("copy-code").onclick = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      showToast("房间码已复制");
    } catch (_) {
      showToast(`房间码：${room.code}`);
    }
  };
  if (room.isHost) {
    document.getElementById("start-game").onclick = () => sendRoomAction("START");
    document.getElementById("round-count").onchange = event => {
      const rounds = Number(event.target.value);
      if (Number.isSafeInteger(rounds) && rounds > 0) sendRoomAction("UPDATE_ROUNDS", { totalRounds: rounds });
      else render();
    };
    document.getElementById("global-state-toggle").onchange = event => {
      sendRoomAction("UPDATE_GLOBAL_STATE", { enabled: event.target.checked });
    };
    document.getElementById("add-bot-simple")?.addEventListener("click", () => sendRoomAction("ADD_BOT", { difficulty: "simple" }));
    document.getElementById("add-bot-normal")?.addEventListener("click", () => sendRoomAction("ADD_BOT", { difficulty: "normal" }));
    document.querySelectorAll(".remove-bot").forEach(btn => {
      btn.onclick = () => sendRoomAction("REMOVE_BOT", { botId: btn.dataset.botId });
    });
    document.querySelectorAll(".transfer-host").forEach(btn => {
      btn.onclick = () => {
        if (confirm("确认将房主转让给该成员？")) sendRoomAction("TRANSFER_HOST", { targetMemberId: btn.dataset.targetId });
      };
    });
  }
}

function renderMemberRow(member) {
  const labels = [
    member.isHost ? '<span class="tag host">房主</span>' : "",
    member.isBot ? `<span class="tag bot">${member.difficulty === "normal" ? "普通AI" : "简单AI"}</span>` : "",
    member.spectator ? '<span class="tag spectator">观战</span>' : "",
    !member.connected ? '<span class="tag bad">掉线</span>' : "",
    member.id === room.myId ? '<span class="tag">你</span>' : ""
  ].join("");
  return `<div class="member-row">
    <span class="member-dot ${member.connected ? "" : "offline"}"></span>
    <span class="member-name">${escapeHtml(member.name)}</span>
    ${labels}
    ${room.isHost && member.isBot && room.lifecycle === ROOM_STATE.WAITING ? `<button class="btn icon-only small danger remove-bot" data-bot-id="${member.id}" title="移除">${icon("x", 12)}</button>` : ""}
    ${room.isHost && !member.isBot && member.connected && !member.spectator && member.id !== room.myId ? `<button class="btn icon-only small transfer-host" data-target-id="${member.id}" title="转让房主">${icon("crown", 12)}</button>` : ""}
  </div>`;
}

function computeRankMap(players, scoreFn) {
  const map = new Map();
  players.forEach(player => {
    const better = players.filter(other => scoreFn(other) > scoreFn(player)).length;
    map.set(player.memberId, better + 1);
  });
  return map;
}

function isReputationHidden() {
  return globalModifierActive("silence") || globalModifierActive("pure");
}

function isDimensionHidden(dim) {
  return globalModifierActive("hidden") && (dim === "config" || dim === "abstract" || dim === "concrete");
}

function renderGlobalModifierBanner() {
  const modifier = globalModifierDefinition(game?.globalModifier);
  if (!modifier) return "";
  return `<div class="global-modifier-banner">${icon("zap", 15)} <strong>全局状态：${escapeHtml(modifier.name)}</strong><span>${escapeHtml(modifier.description)}</span></div>`;
}

function renderGame() {
  const me = myGamePlayer();
  const current = currentPlayer();
  const draft = game.phase === GAME_PHASE.DRAFT;
  const phaseLabel = draft ? "购置阶段" : `第${game.round}/${game.totalRounds}轮`;
  const scoreRank = computeRankMap(game.players, totalScore);
  const reputationRank = computeRankMap(game.players, player => player.reputation ?? 0);
  app.innerHTML = `
    ${topbar("谱师卡牌", `<span class="state-pill">${phaseLabel}</span>
      <div class="turn-line">当前：<strong>${escapeHtml(current?.name || "")}</strong>${draft ? "购置角色" : "进行回合"}</div>`)}
    ${renderGlobalModifierBanner()}
    ${isSpectator() ? `<div class="spectator-banner">${icon("eye", 15)} 观战模式：你可以查看公开数据，但不能查看手牌或执行操作。</div>` : ""}
    <div class="game-layout">
      <aside class="side-column">
        <section class="section">
          <div class="section-head"><h2>玩家</h2><span class="section-note">${game.players.length}人</span></div>
          ${game.players.map((player, index) => renderPlayerMini(player, index, scoreRank, reputationRank)).join("")}
        </section>
        <section class="section">
          <div class="section-head"><h2>操作记录</h2></div>
          <div class="log-list">${game.log.slice().reverse().map(renderLog).join("")}</div>
        </section>
      </aside>
      <div class="main-column">
        ${renderDimensionPanel(me)}
        ${draft ? renderDraft(me) : renderTurn(me)}
      </div>
    </div>`;
  bindTopbar();
  if (draft) bindDraft(me);
  else bindTurn(me);
}

function renderDimensionPanel(player) {
  if (!player) return "";
  return `<div class="dimension-panel">
    ${DIMENSIONS.map(dim => `<div class="dimension"><div class="dimension-label">${DIMENSION_LABELS[dim]} · ${SCORE_WEIGHTS[dim] * 100}%</div><div class="dimension-value">${isDimensionHidden(dim) ? "?" : formatNumber(player.scores[dim])}</div></div>`).join("")}
    <div class="dimension reputation"><div class="dimension-label">声望 / 总分</div><div class="dimension-value">${isReputationHidden() ? "?" : player.reputation} <span class="dimension-total">· ${totalScore(player)}</span></div></div>
  </div>`;
}



function renderPlayerMini(player, index, scoreRank, reputationRank) {
  const active = index === game.currentPlayerIndex;
  const statuses = [
    player.disableAllSkillTurns > 0 || player.disableUntilOwnTurn ? `<span class="tag bad">禁用技能</span>` : "",
    player.disableCharacterTurns > 0 ? `<span class="tag bad">角色禁用${player.disableCharacterTurns}</span>` : "",
    player.reviewTurns > 0 ? `<span class="tag good">评议${player.reviewTurns}</span>` : "",
    player.frozen ? '<span class="tag bad">点数定格</span>' : "",
    player.storyboard ? '<span class="tag good">故事板</span>' : "",
    player.aiControlled ? '<span class="tag good">AI托管</span>' : (!player.connected ? '<span class="tag bad">掉线</span>' : "")
  ].join("");
  const score = totalScore(player);
  const reputation = player.reputation ?? 0;
  const hideRep = isReputationHidden();
  const isMe = player.memberId === room.myId;
  const wjcHidesCharacters = globalModifierActive("wjc") && !isMe;
  const dimsHtml = DIMENSIONS.map(dim => `<span class="mini-dim">${DIMENSION_LABELS[dim].slice(0, 2)}<b>${isDimensionHidden(dim) ? "?" : player.scores[dim]}</b></span>`).join("");
  const charactersHtml = player.characters?.length
    ? `<div class="mini-characters">${wjcHidesCharacters
        ? `<span class="character-chip" title="无法查看">??? × ${player.characters.length}</span>`
        : player.characters.map(instance => {
            const character = characterDefinition(instance.id);
            const stats = characterStats(instance.id);
            const disabled = instance.disabledTurns > 0 || instance.permanentlyDisabled;
            return `<span class="character-chip ${disabled ? "bad" : ""}" title="${escapeHtml(character.name)} · 选曲品味 ${stats.selection}${instance.permanentlyDisabled ? " · 永久禁用" : instance.disabledTurns ? ` · 禁用${instance.disabledTurns}回合` : ""}">${escapeHtml(character.name.slice(0, 2))}</span>`;
          }).join("")}</div>`
    : "";
  return `<div class="player-mini ${active ? "active" : ""} ${isMe ? "me" : ""}">
    <div class="player-mini-head"><span class="player-mini-name">${escapeHtml(player.name)}</span>${active ? '<span class="tag good">当前</span>' : ""}${statuses}</div>
    <div class="mini-rank">
      <span class="mini-rank-item" title="综合得分">综合 <b>${score}</b> · 第${scoreRank.get(player.memberId)}名</span>
      ${hideRep ? "" : `<span class="mini-rank-item" title="声望值">声望 <b>${reputation}</b> · 第${reputationRank.get(player.memberId)}名</span>`}
    </div>
    <div class="mini-dims">${dimsHtml}</div>
    ${charactersHtml}
  </div>`;
}

function scrambleCharacterNames(text) {
  if (!globalModifierActive("wjc")) return String(text ?? "");
  let result = String(text ?? "");
  CHARACTERS.forEach(character => {
    result = result.split(character.name).join("（乱码）");
  });
  return result;
}

function renderLog(entry) {
  return `<div class="log-entry ${entry.type}"><span class="log-round">${entry.round ? `R${entry.round}` : "准备"}</span><span class="log-text">${escapeHtml(scrambleCharacterNames(entry.text))}</span></div>`;
}

function renderDraft(me) {
  const active = isMyTurn() && !isSpectator();
  return `
    <div class="phase-banner">${icon("shopping-basket", 19)}<div><strong>${active ? "轮到你购置角色" : `等待 ${escapeHtml(currentPlayer()?.name)} 购置`}</strong><span>每名玩家拥有12点，不可重复购置同一角色。</span></div></div>
    <section class="section">
      <div class="section-head"><h2>角色卡池</h2><span class="shop-balance">剩余 ${me?.funds ?? "-"} 点</span></div>
      <div class="character-grid">${CHARACTERS.map(character => renderShopCard(character, me, active)).join("")}</div>
    </section>
    <div class="actionbar">
      <span class="action-hint">${active ? "确认完成后将轮到下一名玩家。" : "非当前购置玩家不能操作。"}</span>
      ${active ? `<button class="btn primary" id="draft-done" ${me?.characters.length ? "" : "disabled"}>${icon("check", 15)} 完成购置</button>` : ""}
    </div>`;
}

function renderShopCard(character, me, active) {
  const price = RARITY[character.rarity].price;
  const owned = me?.characters.some(item => item.id === character.id);
  const affordable = Boolean(active && me && me.funds >= price && !owned);
  const stats = characterStats(character.id);
  return `<article class="game-card character">
    <div class="card-top"><span class="card-kind">角色</span><span class="rarity">${character.rarity}</span></div>
    <div class="card-glyph">${icon(character.glyph, 28)}</div>
    <div class="card-name">${escapeHtml(character.name)}</div>
    ${character.lore ? `<div class="card-lore">${escapeHtml(character.lore)}</div>` : ""}
    <div class="character-stats">${CHARACTER_STATS.map(stat => `<div class="character-stat"><span>${CHARACTER_STAT_LABELS[stat]}</span><b>★${stats[stat]}</b></div>`).join("")}</div>
    <div class="card-desc">
      ${character.abilities.map((ability, index) => `<div class="card-effect"><strong>${character.abilities.length > 1 ? `角色技能${index + 1}` : "角色技能"}</strong> ${escapeHtml(ability.description)}</div>`).join("")}
      <div class="card-passive"><strong>被动技能</strong> ${escapeHtml(character.passive)}</div>
    </div>
    <div class="card-meta">购置 ${price}点 · 选曲品味 ${stats.selection}</div>
    <div class="card-action">${owned
      ? '<div class="owned-mark">已购置</div>'
      : `<button class="btn ${affordable ? "coral" : ""}" data-buy="${character.id}" ${affordable ? "" : "disabled"}>${icon("coins", 14)} ${price}点购置</button>`}</div>
  </article>`;
}

function bindDraft(me) {
  document.querySelectorAll("[data-buy]").forEach(button => {
    button.onclick = () => sendGameAction("DRAFT_BUY", { characterId: button.dataset.buy });
  });
  const done = document.getElementById("draft-done");
  if (done) done.onclick = () => sendGameAction("DRAFT_DONE");
}

function renderTurn(me) {
  const ownTurn = isMyTurn() && !isSpectator();
  const firstRound = game.round === 1;
  const mustUseCharacter = ownTurn && firstRound && !me?.firstRoundSkillUsed;
  const hand = me?.hand || [];
  let instruction = `等待 ${escapeHtml(currentPlayer()?.name)} 完成回合`;
  if (mustUseCharacter) instruction = "第1轮只能发动1次角色技能，不摸牌且不能使用技能牌";
  else if (ownTurn && firstRound) instruction = "角色技能已发动，可以结束回合";
  else if (ownTurn && !game.turn.hasDrawn) instruction = "本轮必须且只能摸1张牌";
  else if (ownTurn) instruction = "可以发动角色技能、打出技能牌或结束回合";
  return `
    <div class="phase-banner">${icon(mustUseCharacter ? "circle-alert" : "route", 19)}<div><strong>${instruction}</strong><span>${firstRound ? "首轮不摸牌 · 禁用技能牌" : `牌堆 ${game.deck.length} · 弃牌 ${game.discard.length} · 手牌上限 ${me?.handLimit ?? 5} · 本回合可出 ${game.turn.playableCards ?? 0} 张`}</span></div></div>
    ${renderPlayerStatuses(me, ownTurn)}
    ${renderResponsePanel(me)}
    <section class="section">
      <div class="section-head"><h2>手牌</h2><span class="section-note">${me ? `${me.handCount} / ${me.handLimit ?? 5} 张` : "不可见"}</span></div>
      ${hand.length ? `<div class="card-row">${hand.map(card => renderSkillCard(card, me, ownTurn)).join("")}</div>` : '<div class="empty">暂无技能牌。事件牌摸到后会立即触发，不会进入这里。</div>'}
    </section>
    <section class="section">
      <div class="section-head"><h2>角色技能</h2><span class="section-note">角色牌只能发动技能</span></div>
      ${me?.characters.length ? `<div class="ability-grid">${me.characters.map(instance => renderAbility(instance, me, ownTurn)).join("")}</div>` : '<div class="empty">未购置角色</div>'}
    </section>
    ${(() => {
      const managed = me && !me.isBot && me.aiControlled;
      const disabledChars = (me?.characters || []).filter(c => c.permanentlyDisabled || c.disabledTurns > 0);
      const canRestore = ownTurn && game.phase === GAME_PHASE.TURN && game.round > 0 && !ui.pendingRequest && !managed && (me?.reputation ?? 0) >= 10 && disabledChars.length > 0;
      if (!disabledChars.length && !canRestore) return "";
      const items = disabledChars.map(instance => {
        const def = characterDefinition(instance.id);
        const status = instance.permanentlyDisabled ? "永久失效" : `禁用${instance.disabledTurns}回合`;
        return `<span class="character-chip bad" title="${escapeHtml(def.name)} · ${status}">${escapeHtml(def.name.slice(0, 2))} · ${status}</span>`;
      }).join("");
      return `<section class="section">
        <div class="section-head"><h2>被禁用的角色</h2><span class="section-note">共 ${disabledChars.length} 名</span></div>
        ${disabledChars.length ? `<div class="mini-characters">${items}</div>
        <div style="margin-top:10px">
          <button class="btn" id="restore-character-btn" ${canRestore ? "" : "disabled"} title="${canRestore ? `花费 10 点声望使一个被禁用的角色立即恢复可用` : me?.reputation < 10 ? `需要 10 点声望（当前 ${me?.reputation ?? 0}）` : !ownTurn ? `等待自己的回合` : managed ? `AI 托管中不可操作` : `暂无可恢复角色`}">${icon("rotate-ccw", 14)} 花 10 声望恢复被禁用角色</button>
        </div>` : '<div class="empty">暂无被禁用的角色</div>'}
      </section>`;
    })()}
    <div class="actionbar">
      <span class="action-hint">${instruction}</span>
      ${ownTurn && !firstRound && !game.turn.hasDrawn ? `<button class="btn primary" id="draw-card" ${(ui.pendingRequest || me.hand.length >= (me.handLimit ?? 5)) ? "disabled" : ""}>${icon("hand", 15)} ${me.hand.length >= (me.handLimit ?? 5) ? "手牌已满" : "摸1张牌"}</button>` : ""}
      ${ownTurn ? `<button class="btn coral" id="end-turn" ${(mustUseCharacter || (!firstRound && !game.turn.hasDrawn) || ui.pendingRequest) ? "disabled" : ""}>${icon("skip-forward", 15)} 结束回合</button>` : ""}
    </div>`;
}

function renderResponsePanel(me) {
  if (!me) return "";
  const managed = me && !me.isBot && me.aiControlled;
  const meIndex = game.players.findIndex(p => p.memberId === me.memberId);
  let html = "";
  if (me.overtureActive) {
    const reduceCan = !me.overtureReduceUsed && !ui.pendingRequest && !managed && game.lastReduction && game.lastReduction.turn === game.turn.number;
    const discardCan = !me.overtureDiscardUsed && !ui.pendingRequest && !managed && game.lastDiscard && game.lastDiscard.turn === game.turn.number;
    html += `<div class="overture-panel">
      <div class="overture-title">${icon("music", 14)} 序曲响应（每轮各1次）</div>
      <button class="btn ${reduceCan ? "coral" : ""}" id="overture-reduce" ${reduceCan ? "" : "disabled"}>减分响应 ${me.overtureReduceUsed ? "已用" : "1次"}</button>
      <button class="btn ${discardCan ? "coral" : ""}" id="overture-discard" ${discardCan ? "" : "disabled"}>弃牌响应 ${me.overtureDiscardUsed ? "已用" : "1次"}</button>
    </div>`;
  }
  if (game.dystopia && game.dystopia.ownerIndex === meIndex && !managed && !ui.pendingRequest) {
    html += `<div class="overture-panel">
      <div class="overture-title">${icon("shield-off", 14)} 反乌托邦（待抵消队列 ${game.dystopiaQueue.filter(q => !q.offset).length}）</div>
      <button class="btn" id="dystopia-offset" ${me.hand.length ? "" : "disabled"}>弃1张牌抵消减分</button>
    </div>`;
  }
  return html;
}

function renderPlayerStatuses(me, ownTurn) {
  if (!me) return "";
  const statuses = [
    me.reviewTurns > 0 ? `<span class="tag good">评议剩余${me.reviewTurns}回合</span>` : "",
    me.storyboard ? '<span class="tag good">故事板 +5</span>' : "",
    me.worldTreeActive ? `<span class="tag good">生机 ${me.vitality ?? 0} / 3</span>` : "",
    me.frozen ? '<span class="tag bad">所有点数定格</span>' : "",
    me.commissionLocked ? '<span class="tag bad">约稿点数锁定</span>' : "",
    me.commissionLockAtRound != null && !me.commissionLocked ? `<span class="tag">第${me.commissionLockAtRound}轮锁定</span>` : "",
    me.disableAllSkillTurns > 0 || me.disableUntilOwnTurn ? '<span class="tag bad">本回合不可发动技能</span>' : "",
    me.disableCharacterTurns > 0 ? `<span class="tag bad">角色技能禁用${me.disableCharacterTurns}回合</span>` : ""
  ].filter(Boolean);
  const managed = me && !me.isBot && me.aiControlled;
  const canReview = ownTurn && game.round > 1 && me.reviewTurns > 0 && !me.reviewActionUsed && !isAllSkillBlocked(me) && !ui.pendingRequest && !managed;
  if (!statuses.length && !canReview) return "";
  return `<div class="status-row">${statuses.join("")}${canReview ? `<button class="btn small" id="review-vote">${icon("tickets", 14)} 进行评议</button>` : ""}</div>`;
}

function renderSkillCard(card, me, ownTurn) {
  if (card.type === "star") {
    return `<article class="game-card skill rarity-white star-card">
      <div class="card-top"><span class="card-kind">特殊</span><span class="rarity rarity-white">星</span></div>
      <div class="card-glyph">${icon("star", 28)}</div>
      <div class="card-name">星</div>
      <div class="card-desc">无法打出，不计入手牌上限。受到减分时自动弃置，每8点具象动效抵消1点减分。</div>
      <div class="card-meta">特殊牌</div>
    </article>`;
  }
  const definition = skillDefinition(card.cardId);
  const managed = me && !me.isBot && me.aiControlled;
  const canUse = ownTurn && game.round > 1 && !ui.pendingRequest && !isAllSkillBlocked(me) && !managed;
  const canDiscard = ownTurn && !ui.pendingRequest && !managed && game.phase === GAME_PHASE.TURN && game.round >= 1;
  let meta = "自己的回合使用";
  if (game.round === 1) meta = "第1轮不可使用";
  else if (managed) meta = "AI 托管中不可操作";
  else if (isAllSkillBlocked(me)) meta = "本回合不可发动技能";
  const rarityKey = definition.rarity || "white";
  const rarityLabel = SKILL_RARITY[rarityKey]?.label || "白";
  const categoryLabel = { growth: "成长", attack: "进攻", skill: "技能", draw: "抽牌" }[definition.category] || "技能";
  return `<article class="game-card skill rarity-${rarityKey}">
    <div class="card-top"><span class="card-kind">${categoryLabel}</span><span class="rarity rarity-${rarityKey}">${rarityLabel}</span></div>
    <div class="card-glyph">${icon(definition.glyph, 28)}</div>
    <div class="card-name">${escapeHtml(definition.name)}</div>
    <div class="card-desc">${escapeHtml(definition.description)}</div>
    <div class="card-meta">${meta}</div>
    <div class="card-action">
      <button class="btn" data-play-card="${card.uid}" ${canUse ? "" : "disabled"}>${icon("play", 13)} 使用</button>
      <button class="btn" data-discard-card="${card.uid}" ${canDiscard ? "" : "disabled"} title="弃置此牌（本回合可打出的牌数-1）">${icon("trash-2", 13)} 弃牌</button>
      <button class="btn" data-info-card="${card.uid}">${icon("info", 13)} 信息</button>
    </div>
  </article>`;
}

function renderAbility(instance, me, ownTurn) {
  const definition = characterDefinition(instance.id);
  const managed = me && !me.isBot && me.aiControlled;
  return definition.abilities.map((ability, abilityIndex) => {
    const allowed = managed ? fail("AI 托管中不可操作") : (ownTurn ? canActivateCharacter(me, instance, ability) : fail("等待自己的回合"));
    const canUse = ownTurn && !ui.pendingRequest && allowed.ok && !managed;
    return `<article class="ability-item">
      <div class="ability-head"><div><div class="ability-name">${definition.abilities.length > 1 ? `角色技能${abilityIndex + 1}` : "角色技能"}</div><div class="ability-owner">${escapeHtml(definition.name)}</div></div><span class="tag ${canUse ? "good" : ""}">${canUse ? "可发动" : escapeHtml(allowed.reason)}</span></div>
      <div class="ability-desc">${escapeHtml(ability.description)}</div>
      ${abilityIndex === 0 ? `<div class="ability-passive"><strong>被动：</strong>${escapeHtml(definition.passive)}</div>` : ""}
      <button class="btn" data-character="${definition.id}" data-ability="${ability.id}" ${canUse ? "" : "disabled"}>${icon("sparkles", 13)} 发动技能</button>
    </article>`;
  }).join("");
}

function bindTurn(me) {
  document.getElementById("draw-card")?.addEventListener("click", () => sendGameAction("DRAW"));
  document.getElementById("end-turn")?.addEventListener("click", () => sendGameAction("END_TURN"));
  document.querySelectorAll("[data-play-card]").forEach(button => {
    button.onclick = () => openCardAction(button.dataset.playCard);
  });
  document.querySelectorAll("[data-discard-card]").forEach(button => {
    button.onclick = () => sendGameAction("DISCARD_CARD", { cardUid: button.dataset.discardCard });
  });
  document.querySelectorAll("[data-info-card]").forEach(button => {
    button.onclick = () => openCardInfo(button.dataset.infoCard);
  });
  document.querySelectorAll("[data-ability]").forEach(button => {
    button.onclick = () => openAbilityAction(button.dataset.character, button.dataset.ability);
  });
  document.getElementById("review-vote")?.addEventListener("click", openReviewAction);
  document.getElementById("restore-character-btn")?.addEventListener("click", openRestoreCharacterAction);
  document.getElementById("overture-reduce")?.addEventListener("click", () => sendGameAction("OVERTURE_REDUCE"));
  document.getElementById("overture-discard")?.addEventListener("click", () => sendGameAction("OVERTURE_DISCARD"));
  document.getElementById("dystopia-offset")?.addEventListener("click", () => {
    const me = myGamePlayer();
    if (me?.hand?.length) {
      // 简化：弃置最后一张手牌触发抵消
      sendGameAction("DYSTOPIA_OFFSET", { cardUid: me.hand[me.hand.length - 1].uid });
    }
  });
}

function openRestoreCharacterAction() {
  const me = myGamePlayer();
  if (!me) return;
  const disabled = me.characters.filter(c => c.permanentlyDisabled || c.disabledTurns > 0);
  if (!disabled.length) return;
  ui.modal = {
    kind: "restore-character",
    title: "花 10 声望恢复被禁用角色",
    description: `选择一个被禁用的角色，立即花费 10 点声望（当前：${me.reputation} 点）使其恢复可用状态。恢复永久失效的角色后可重新发动技能。`,
    characters: disabled,
    selectedCharacterUid: null
  };
  render();
}

function openCardAction(cardUid) {
  const me = myGamePlayer();
  const card = me?.hand.find(item => item.uid === cardUid);
  const definition = skillDefinition(card?.cardId);
  if (!card || !definition) return;
  const mode = definition.targetMode;
  if (mode === TARGET_MODE.NONE) {
    return sendGameAction("PLAY_CARD", { cardUid });
  }
  if (mode === TARGET_MODE.OWN_DIMENSION) {
    ui.modal = { kind: "skill-own-dimension", cardUid, title: definition.name, description: definition.description, selectedDimension: null };
    return render();
  }
  if (mode === TARGET_MODE.PLAYER) {
    const targets = game.players.filter(player => player.memberId !== me.memberId);
    ui.modal = { kind: "skill-target-player", cardUid, title: definition.name, description: definition.description, targets };
    return render();
  }
  if (mode === TARGET_MODE.PLAYER_AND_DIMENSION) {
    const targets = game.players.filter(player => player.memberId !== me.memberId);
    ui.modal = { kind: "skill-player-dimension", cardUid, title: definition.name, description: definition.description, targets, selectedTarget: null, selectedDimension: null };
    return render();
  }
  if (mode === TARGET_MODE.OWN_AND_OPPONENT_CHARACTERS) {
    const ownCharacters = me.characters;
    const opponentCharacters = [];
    game.players.forEach(p => {
      if (p.memberId !== me.memberId) {
        p.characters.forEach(c => opponentCharacters.push({ ...c, ownerName: p.name }));
      }
    });
    ui.modal = { kind: "skill-own-opponent-characters", cardUid, title: definition.name, description: definition.description, ownCharacters, opponentCharacters, selectedOwnUid: null, selectedOpponentUids: [] };
    return render();
  }
  if (mode === TARGET_MODE.OWN_CHARACTER) {
    const ownCharacters = me.characters.filter(c => !c.permanentlyDisabled && (c.disabledTurns > 0 || Object.values(c.cooldowns || {}).some(v => v > 0)));
    if (!ownCharacters.length) return showToast("没有需要恢复的角色");
    ui.modal = { kind: "skill-own-character", cardUid, title: definition.name, description: definition.description, characters: ownCharacters, selectedCharacterUid: null };
    return render();
  }
  if (mode === TARGET_MODE.ANY_CHARACTER) {
    const characters = [];
    game.players.forEach(p => {
      p.characters.forEach(c => {
        if (!c.permanentlyDisabled) characters.push({ ...c, ownerName: p.name });
      });
    });
    if (!characters.length) return showToast("场上没有可发动的角色");
    ui.modal = { kind: "skill-any-character", cardUid, title: definition.name, description: definition.description, characters, selectedCharacterUid: null };
    return render();
  }
  if (mode === TARGET_MODE.OWN_CHARACTER_AND_DIMENSION) {
    const ownCharacters = me.characters.filter(c => !c.permanentlyDisabled);
    if (!ownCharacters.length) return showToast("没有可选择的谱师");
    ui.modal = { kind: "skill-own-character-dimension", cardUid, title: definition.name, description: definition.description, characters: ownCharacters, selectedCharacterUid: null, selectedDimension: null };
    return render();
  }
  if (mode === TARGET_MODE.OWN_AVAILABLE_CHARACTER) {
    const ownCharacters = me.characters.filter(c => !c.permanentlyDisabled && c.disabledTurns === 0);
    if (!ownCharacters.length) return showToast("没有技能可用的角色");
    ui.modal = { kind: "skill-own-available-character", cardUid, title: definition.name, description: definition.description, characters: ownCharacters, selectedCharacterUid: null };
    return render();
  }
  if (mode === TARGET_MODE.SELF_CARD) {
    const cards = me.hand.filter(c => c.uid !== cardUid);
    if (!cards.length) return sendGameAction("PLAY_CARD", { cardUid });
    ui.modal = { kind: "skill-discard-one", cardUid, title: definition.name, description: definition.description, cards, selectedUid: null };
    return render();
  }
  if (definition.target === "self") return sendGameAction("PLAY_CARD", { cardUid });
  const targets = game.players.filter(player => player.memberId !== me.memberId);
  ui.modal = { kind: "target-card", cardUid, title: definition.name, description: definition.description, targets };
  render();
}

function openCardInfo(cardUid) {
  const me = myGamePlayer();
  const card = me?.hand.find(item => item.uid === cardUid);
  if (!card) return;
  if (card.type === "star") {
    ui.modal = {
      kind: "card-info",
      title: "星（特殊牌）",
      description: "无法打出，不计入手牌上限。受到减分时弃置抵消：每8点具象动效抵消1点减分。此牌不进入牌堆。"
    };
    return render();
  }
  const definition = skillDefinition(card.cardId);
  if (!definition) return;
  const rarityKey = definition.rarity || "white";
  const categoryLabel = { growth: "成长", attack: "进攻", skill: "技能", draw: "抽牌" }[definition.category] || "技能";
  ui.modal = {
    kind: "card-info",
    title: definition.name,
    description: `${definition.description}（${categoryLabel} · ${SKILL_RARITY[rarityKey]?.label || "白"}稀有度）`
  };
  render();
}

function openAbilityAction(characterId, abilityId) {
  const definition = characterDefinition(characterId);
  const ability = characterAbilityDefinition(characterId, abilityId);
  if (!definition || !ability) return;
  if (ability.choice === "two-dimensions") {
    ui.modal = { kind: "two-dimensions", characterId, abilityId, title: definition.name, description: ability.description, selected: [] };
  } else if (ability.choice === "three-dimensions") {
    ui.modal = { kind: "three-dimensions", characterId, abilityId, title: definition.name, description: ability.description, selected: [] };
  } else if (ability.choice === "motion-distribution") {
    ui.modal = { kind: "motion-distribution", characterId, abilityId, title: definition.name, description: ability.description };
  } else if (ability.choice === "up-to-two-targets") {
    ui.modal = {
      kind: "up-to-two-targets",
      characterId,
      abilityId,
      title: definition.name,
      description: ability.description,
      targets: game.players.filter(player => player.memberId !== room.myId),
      selected: []
    };
  } else if (ability.choice === "opponent") {
    const me = myGamePlayer();
    const costHint = characterId === "chi-mahu" && me ? ` （当前声望代价：${me.handExchangeCost ?? 1} 点，下次发动翻倍）` : "";
    ui.modal = {
      kind: "target-ability",
      characterId,
      abilityId,
      title: definition.name,
      description: ability.description + costHint,
      targets: game.players.filter(player => player.memberId !== room.myId)
    };
  } else if (ability.choice === "opponent-card") {
    ui.modal = {
      kind: "ability-opponent-card",
      characterId,
      abilityId,
      title: definition.name,
      description: ability.description,
      targets: game.players.filter(player => player.memberId !== room.myId),
      selectedTarget: null,
      cards: [],
      selectedCardUid: null
    };
  } else if (ability.choice === "discard-cards") {
    const me = myGamePlayer();
    const cards = (me?.hand || []).filter(c => c.type !== "star");
    if (!cards.length) return showToast("没有可弃置的技能牌");
    ui.modal = {
      kind: "ability-discard-cards",
      characterId,
      abilityId,
      title: definition.name,
      description: ability.description,
      cards,
      selectedUids: []
    };
  } else if (ability.choice === "rarity") {
    const me = myGamePlayer();
    const rarities = Object.keys(SKILL_RARITY).filter(r => (me?.hand || []).some(c => c.type !== "star" && skillDefinition(c.cardId)?.rarity === r));
    ui.modal = {
      kind: "ability-rarity",
      characterId,
      abilityId,
      title: definition.name,
      description: ability.description,
      rarities
    };
  } else if (ability.choice === "own-peak-dimension") {
    const me = myGamePlayer();
    const peakValue = Math.max(...CHANGEABLE_DIMENSIONS.map(d => me?.scores[d] ?? 0));
    const dims = CHANGEABLE_DIMENSIONS.filter(d => (me?.scores[d] ?? 0) === peakValue);
    ui.modal = {
      kind: "ability-peak-dimension",
      characterId,
      abilityId,
      title: definition.name,
      description: ability.description,
      dimensions: dims
    };
  } else {
    return sendGameAction("ACTIVATE_CHARACTER", { characterId, abilityId });
  }
  render();
}

function openReviewAction() {
  ui.modal = {
    kind: "review-vote",
    title: "评议",
    description: skillDefinition("review").description,
    targets: game.players
  };
  render();
}

function renderActionModal() {
  const modal = ui.modal;
  const me = myGamePlayer();
  let choices = "";
  if (modal.kind === "star-mitigation") {
    choices = `<div class="modal-actions" style="justify-content:center">
      <button class="btn primary" data-star-decision="accept">${icon("check", 15)} 弃星抵消</button>
      <button class="btn coral" data-star-decision="decline">${icon("x", 15)} 不抵消</button>
    </div>`;
  } else if (modal.kind === "arithmetic") {
    choices = `<div class="event-step"><div class="event-step-title">选择答案正确的选项（其中一道答案为9）</div><div class="target-list">${modal.questions.map((q, i) => `<button class="target-btn" data-arithmetic-answer="${i}"><span>${escapeHtml(q.text)} = ?</span><span class="target-score">选择</span></button>`).join("")}</div></div>`;
  } else if (modal.kind === "seven-trace") {
    const cardButtons = modal.cards.map(card => {
      const def = skillDefinition(card.cardId);
      const rarityLabel = SKILL_RARITY[def?.rarity]?.label || "白";
      const categoryLabel = { growth: "成长", attack: "进攻", skill: "技能", draw: "抽牌" }[def?.category] || "技能";
      return `<button class="target-btn" data-seven-trace-pick="${card.uid}"><span>${escapeHtml(def?.name || "牌")}（${rarityLabel} · ${categoryLabel}）</span><span class="target-score">选择</span></button>`;
    }).join("");
    choices = `<div class="event-step"><div class="event-step-title">选择1张牌加入手牌</div><div class="target-list">${cardButtons}</div></div>`;
  } else if (modal.kind === "target-card" || modal.kind === "target-ability" || modal.kind === "skill-target-player") {
    choices = `<div class="target-list">${modal.targets.map(target => `<button class="target-btn" data-select-target="${target.memberId}"><span>${escapeHtml(target.name)}</span><span class="target-score">${totalScore(target)}分</span></button>`).join("")}</div>`;
  } else if (modal.kind === "motion-distribution") {
    choices = `<div class="target-list">
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(value => `<button class="target-btn" data-motion-points="${value}"><span>抽象 ${value} · 具象 ${10 - value}</span><span class="target-score">10点</span></button>`).join("")}
    </div>`;
  } else if (modal.kind === "two-dimensions") {
    choices = `<div class="target-list">${CHANGEABLE_DIMENSIONS.map(dim => `<button class="target-btn ${modal.selected.includes(dim) ? "selected" : ""}" data-toggle-dimension="${dim}"><span>${DIMENSION_LABELS[dim]}</span><span class="target-score">${modal.selected.includes(dim) ? "已选" : "选择"}</span></button>`).join("")}</div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${modal.selected.length === 2 ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "three-dimensions") {
    choices = `<div class="target-list">${CHANGEABLE_DIMENSIONS.map(dim => `<button class="target-btn ${modal.selected.includes(dim) ? "selected" : ""}" data-toggle-dimension="${dim}"><span>${DIMENSION_LABELS[dim]}</span><span class="target-score">${modal.selected.includes(dim) ? "已选" : "选择"}</span></button>`).join("")}</div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${modal.selected.length === 3 ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "up-to-two-targets") {
    choices = `<div class="target-list">${modal.targets.map(target => `<button class="target-btn ${modal.selected.includes(target.memberId) ? "selected" : ""}" data-toggle-target="${target.memberId}"><span>${escapeHtml(target.name)}</span><span class="target-score">${modal.selected.includes(target.memberId) ? "已选" : "选择"}</span></button>`).join("")}</div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal">确定</button></div>`;
  } else if (modal.kind === "skill-own-dimension") {
    const dimensionButtons = CHANGEABLE_DIMENSIONS.map(dim => {
      const selected = modal.selectedDimension === dim;
      return `<button class="target-btn ${selected ? "selected" : ""}" data-skill-own-dimension="${dim}"><span>${DIMENSION_LABELS[dim]}</span><span class="target-score">当前: ${me?.scores?.[dim] ?? 0}</span></button>`;
    }).join("");
    const canConfirm = modal.selectedDimension;
    choices = `<div class="event-step"><div class="event-step-title">选择要提升的属性</div><div class="target-list">${dimensionButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${canConfirm ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "skill-player-dimension") {
    const playerButtons = modal.targets.map(target => {
      const selected = modal.selectedTarget === target.memberId;
      return `<button class="target-btn ${selected ? "selected" : ""}" data-skill-target="${target.memberId}"><span>${escapeHtml(target.name)}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    const dimensionButtons = CHANGEABLE_DIMENSIONS.map(dim => {
      const selected = modal.selectedDimension === dim;
      return `<button class="target-btn ${selected ? "selected" : ""}" ${modal.selectedTarget ? "" : "disabled"} data-skill-dimension="${dim}"><span>${DIMENSION_LABELS[dim]}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    const canConfirm = modal.selectedTarget && modal.selectedDimension;
    choices = `<div class="event-step"><div class="event-step-title">① 选择目标玩家</div><div class="target-list">${playerButtons}</div></div>
      <div class="event-step"><div class="event-step-title">② 选择属性</div><div class="target-list">${dimensionButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${canConfirm ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "skill-own-opponent-characters") {
    const ownButtons = modal.ownCharacters.map(instance => {
      const def = characterDefinition(instance.id);
      const selected = modal.selectedOwnUid === instance.uid;
      return `<button class="target-btn ${selected ? "selected" : ""}" data-skill-own-char="${instance.uid}"><span>${escapeHtml(def.name)}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    const opponentButtons = modal.opponentCharacters.map(instance => {
      const def = characterDefinition(instance.id);
      const selected = modal.selectedOpponentUids.includes(instance.uid);
      const canSelect = modal.selectedOpponentUids.length < 3 || selected;
      return `<button class="target-btn ${selected ? "selected" : ""}" ${canSelect ? "" : "disabled"} data-skill-opp-char="${instance.uid}"><span>${escapeHtml(def.name)} (${escapeHtml(instance.ownerName)})</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    const canConfirm = modal.selectedOwnUid && modal.selectedOpponentUids.length >= 2 && modal.selectedOpponentUids.length <= 3;
    choices = `<div class="event-step"><div class="event-step-title">① 选择自己的1张角色卡</div><div class="target-list">${ownButtons}</div></div>
      <div class="event-step"><div class="event-step-title">② 选择其他玩家的2~3张角色卡</div><div class="target-list">${opponentButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${canConfirm ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "skill-own-character") {
    const charButtons = modal.characters.map(instance => {
      const def = characterDefinition(instance.id);
      const selected = modal.selectedCharacterUid === instance.uid;
      const status = instance.disabledTurns > 0 ? `禁用${instance.disabledTurns}回合` : "冷却中";
      return `<button class="target-btn ${selected ? "selected" : ""}" data-own-char="${instance.uid}"><span>${escapeHtml(def.name)}</span><span class="target-score">${selected ? "已选" : status}</span></button>`;
    }).join("");
    choices = `<div class="event-step"><div class="event-step-title">选择要恢复的角色</div><div class="target-list">${charButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${modal.selectedCharacterUid ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "skill-own-available-character") {
    const charButtons = modal.characters.map(instance => {
      const def = characterDefinition(instance.id);
      const selected = modal.selectedCharacterUid === instance.uid;
      return `<button class="target-btn ${selected ? "selected" : ""}" data-own-available-char="${instance.uid}"><span>${escapeHtml(def.name)}</span><span class="target-score">${selected ? "已选" : "可用"}</span></button>`;
    }).join("");
    choices = `<div class="event-step"><div class="event-step-title">选择要禁用的角色技能</div><div class="target-list">${charButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${modal.selectedCharacterUid ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "skill-any-character") {
    const charButtons = modal.characters.map(instance => {
      const def = characterDefinition(instance.id);
      const selected = modal.selectedCharacterUid === instance.uid;
      return `<button class="target-btn ${selected ? "selected" : ""}" data-any-char="${instance.uid}"><span>${escapeHtml(def.name)}（${escapeHtml(instance.ownerName)}）</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    choices = `<div class="event-step"><div class="event-step-title">选择要参考的角色</div><div class="target-list">${charButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${modal.selectedCharacterUid ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "skill-own-character-dimension") {
    const charButtons = modal.characters.map(instance => {
      const def = characterDefinition(instance.id);
      const selected = modal.selectedCharacterUid === instance.uid;
      return `<button class="target-btn ${selected ? "selected" : ""}" data-effort-char="${instance.uid}"><span>${escapeHtml(def.name)}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    const selectedChar = modal.characters.find(c => c.uid === modal.selectedCharacterUid);
    const dimButtons = CHANGEABLE_DIMENSIONS.map(dim => {
      const selected = modal.selectedDimension === dim;
      const val = selectedChar ? (characterStats(selectedChar.id)?.[dim] ?? 0) : 0;
      return `<button class="target-btn ${selected ? "selected" : ""}" ${modal.selectedCharacterUid ? "" : "disabled"} data-effort-dim="${dim}"><span>${DIMENSION_LABELS[dim]}</span><span class="target-score">${modal.selectedCharacterUid ? `${selected ? "已选" : val}点` : "先选角色"}</span></button>`;
    }).join("");
    const canConfirm = modal.selectedCharacterUid && modal.selectedDimension;
    choices = `<div class="event-step"><div class="event-step-title">① 选择自己的一名谱师</div><div class="target-list">${charButtons}</div></div>
      <div class="event-step"><div class="event-step-title">② 选择ta的一项属性</div><div class="target-list">${dimButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${canConfirm ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "skill-discard-cards") {
    const cardButtons = modal.cards.map(card => {
      const def = skillDefinition(card.cardId);
      const selected = modal.selectedUids.includes(card.uid);
      return `<button class="target-btn ${selected ? "selected" : ""}" data-skill-discard="${card.uid}"><span>${escapeHtml(def.name)}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    choices = `<div class="event-step"><div class="event-step-title">选择要弃置的牌（每弃置1张，配置水平+3）</div><div class="target-list">${cardButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal">确定</button></div>`;
  } else if (modal.kind === "skill-discard-one") {
    const cardButtons = modal.cards.map(card => {
      const def = skillDefinition(card.cardId);
      const selected = modal.selectedUid === card.uid;
      return `<button class="target-btn ${selected ? "selected" : ""}" data-discard-one="${card.uid}"><span>${escapeHtml(def.name)}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    choices = `<div class="event-step"><div class="event-step-title">选择1张要弃置的牌</div><div class="target-list">${cardButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${modal.selectedUid ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "ability-opponent-card") {
    const targetButtons = modal.targets.map(target => {
      const selected = modal.selectedTarget === target.memberId;
      return `<button class="target-btn ${selected ? "selected" : ""}" data-liuzhizhi-target="${target.memberId}"><span>${escapeHtml(target.name)}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    const cardButtons = modal.cards.length
      ? modal.cards.map(card => {
          const def = skillDefinition(card.cardId);
          const selected = modal.selectedCardUid === card.uid;
          return `<button class="target-btn ${selected ? "selected" : ""}" data-liuzhizhi-card="${card.uid}"><span>${escapeHtml(def.name)}（${def.rarity}）</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
        }).join("")
      : '<div class="empty">该玩家没有白色/绿色技能牌</div>';
    const canConfirm = modal.selectedTarget && modal.selectedCardUid;
    choices = `<div class="event-step"><div class="event-step-title">① 选择目标玩家</div><div class="target-list">${targetButtons}</div></div>
      <div class="event-step"><div class="event-step-title">② 选择一张白色/绿色技能牌</div><div class="target-list">${cardButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${canConfirm ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "ability-discard-cards") {
    const cardButtons = modal.cards.map(card => {
      const def = skillDefinition(card.cardId);
      const selected = modal.selectedUids.includes(card.uid);
      const canSelect = modal.selectedUids.length < 3 || selected;
      return `<button class="target-btn ${selected ? "selected" : ""}" ${canSelect ? "" : "disabled"} data-ability-discard="${card.uid}"><span>${escapeHtml(def.name)}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    choices = `<div class="event-step"><div class="event-step-title">选择至多3张要弃置的技能牌</div><div class="target-list">${cardButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${modal.selectedUids.length ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "ability-rarity") {
    const rarityButtons = modal.rarities.map(r => `<button class="target-btn" data-ability-rarity="${r}"><span>${SKILL_RARITY[r]?.label || r}稀有度</span><span class="target-score">弃置该稀有度牌</span></button>`).join("");
    choices = `<div class="event-step"><div class="event-step-title">选择一个稀有度</div><div class="target-list">${rarityButtons || '<div class="empty">没有可弃置的稀有度牌</div>'}</div></div>`;
  } else if (modal.kind === "ability-peak-dimension") {
    const dimButtons = modal.dimensions.map(d => `<button class="target-btn" data-ability-peak-dim="${d}"><span>${DIMENSION_LABELS[d]}</span><span class="target-score">-3 并摸2张</span></button>`).join("");
    choices = `<div class="event-step"><div class="event-step-title">选择要降低的最高维度</div><div class="target-list">${dimButtons}</div></div>`;
  } else if (modal.kind === "review-vote") {
    choices = `<div>${modal.targets.map(target => `<div class="vote-row"><span>${escapeHtml(target.name)}</span><button class="btn small" data-review-target="${target.memberId}" data-vote="green">绿票</button><button class="btn small coral" data-review-target="${target.memberId}" data-vote="red">红票</button></div>`).join("")}</div>`;
  } else if (modal.kind === "event-choose") {
    const characterButtons = modal.requiresOwnCharacter === false
      ? ""
      : (modal.ownCharacters.length
        ? modal.ownCharacters.map(instance => {
            const def = characterDefinition(instance.id);
            const selected = modal.selectedCharacterUid === instance.uid;
            const disabledTag = instance.permanentlyDisabled ? '<span class="tag bad">永久失效</span>' : instance.disabledTurns > 0 ? `<span class="tag bad">禁用${instance.disabledTurns}回合</span>` : "";
            return `<button class="target-btn ${selected ? "selected" : ""}" data-event-character="${instance.uid}"><span>${escapeHtml(def.name)}（选曲品味 ${characterStats(instance.id).selection}） ${disabledTag}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
          }).join("")
        : '<div class="empty">没有可用的角色牌。</div>');
    const targetButtons = modal.targets.map(target => {
      const selected = modal.selectedTargetMemberId === target.memberId;
      return `<button class="target-btn ${selected ? "selected" : ""}" data-event-target="${target.memberId}"><span>${escapeHtml(target.name)}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    const canConfirm = (modal.requiresOwnCharacter === false ? true : modal.selectedCharacterUid) && modal.selectedTargetMemberId;
    choices = `
      ${modal.requiresOwnCharacter === false ? "" : `<div class="event-step"><div class="event-step-title">① 选择自己的角色</div><div class="target-list">${characterButtons}</div></div>`}
      <div class="event-step"><div class="event-step-title">${modal.requiresOwnCharacter === false ? "选择目标玩家" : "② 选择目标玩家"}</div>
      <div class="target-list">${targetButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${canConfirm ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "event-response") {
    const acceptButtons = !modal.mustAccept ? `<div class="modal-actions" style="justify-content:center">
      <button class="btn ${modal.decision === "accept" ? "primary" : ""}" data-event-decision="accept">同意拼机</button>
      <button class="btn coral ${modal.decision === "refuse" ? "primary" : ""}" data-event-decision="refuse">拒绝</button>
    </div>` : "";
    const showCharacters = modal.decision === "accept";
    const characterButtons = !modal.myCharacters.length
      ? '<div class="empty">没有可用的角色牌。</div>'
      : modal.myCharacters.map(instance => {
          const def = characterDefinition(instance.id);
          const selected = modal.selectedCharacterUid === instance.uid;
          const disabledTag = instance.permanentlyDisabled ? '<span class="tag bad">永久失效</span>' : instance.disabledTurns > 0 ? `<span class="tag bad">禁用${instance.disabledTurns}回合</span>` : "";
          return `<button class="target-btn ${selected ? "selected" : ""}" data-event-resp-character="${instance.uid}"><span>${escapeHtml(def.name)}（选曲品味 ${characterStats(instance.id).selection}） ${disabledTag}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
        }).join("");
    const canConfirm = modal.decision === "refuse" || (modal.decision === "accept" && modal.selectedCharacterUid);
    choices = `
      ${acceptButtons}
      ${showCharacters ? `<div class="event-step"><div class="event-step-title">选择出战的角色</div><div class="target-list">${characterButtons}</div></div>` : ""}
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${canConfirm ? "" : "disabled"}>确定</button></div>`;
  } else if (modal.kind === "restore-character") {
    const characterButtons = modal.characters.map(instance => {
      const def = characterDefinition(instance.id);
      const selected = modal.selectedCharacterUid === instance.uid;
      const status = instance.permanentlyDisabled ? '<span class="tag bad">永久失效</span>' : `<span class="tag bad">禁用${instance.disabledTurns}回合</span>`;
      return `<button class="target-btn ${selected ? "selected" : ""}" data-restore-character="${instance.uid}"><span>${escapeHtml(def.name)}（选曲品味 ${characterStats(instance.id).selection}） ${status}</span><span class="target-score">${selected ? "已选" : "选择"}</span></button>`;
    }).join("");
    choices = `
      <div class="event-step"><div class="event-step-title">选择要恢复的角色</div><div class="target-list">${characterButtons}</div></div>
      <div class="modal-actions"><button class="btn primary" id="confirm-modal" ${modal.selectedCharacterUid ? "" : "disabled"}>花费 10 声望恢复</button></div>`;
  }
  const canCloseModal = modal.kind !== "event-choose" && modal.kind !== "event-response" && modal.kind !== "star-mitigation";
  app.insertAdjacentHTML("beforeend", `<div class="modal"><div class="modal-box">
    <div class="modal-head"><h3>${escapeHtml(modal.title)}</h3>${canCloseModal ? `<button class="btn icon-only small" id="close-modal" title="关闭">${icon("x", 15)}</button>` : ""}</div>
    <div class="modal-desc">${escapeHtml(modal.description)}</div>${choices}
  </div></div>`);
  document.getElementById("close-modal")?.addEventListener("click", () => { ui.modal = null; render(); });
  document.querySelectorAll("[data-select-target]").forEach(button => {
    button.onclick = () => {
      const targetMemberId = button.dataset.selectTarget;
      ui.modal = null;
      if (modal.kind === "target-card" || modal.kind === "skill-target-player") sendGameAction("PLAY_CARD", { cardUid: modal.cardUid, targetMemberId });
      else sendGameAction("ACTIVATE_CHARACTER", { characterId: modal.characterId, abilityId: modal.abilityId, targetMemberId });
    };
  });
  document.querySelectorAll("[data-skill-own-dimension]").forEach(button => {
    button.onclick = () => {
      modal.selectedDimension = button.dataset.skillOwnDimension;
      render();
    };
  });
  document.querySelectorAll("[data-skill-target]").forEach(button => {
    button.onclick = () => {
      modal.selectedTarget = button.dataset.skillTarget;
      modal.selectedDimension = null;
      render();
    };
  });
  document.querySelectorAll("[data-skill-dimension]").forEach(button => {
    button.onclick = () => {
      modal.selectedDimension = button.dataset.skillDimension;
      render();
    };
  });
  document.querySelectorAll("[data-skill-own-char]").forEach(button => {
    button.onclick = () => {
      modal.selectedOwnUid = button.dataset.skillOwnChar;
      render();
    };
  });
  document.querySelectorAll("[data-skill-opp-char]").forEach(button => {
    button.onclick = () => {
      const uid = button.dataset.skillOppChar;
      if (modal.selectedOpponentUids.includes(uid)) {
        modal.selectedOpponentUids = modal.selectedOpponentUids.filter(u => u !== uid);
      } else if (modal.selectedOpponentUids.length < 3) {
        modal.selectedOpponentUids.push(uid);
      }
      render();
    };
  });
  document.querySelectorAll("[data-skill-discard]").forEach(button => {
    button.onclick = () => {
      const uid = button.dataset.skillDiscard;
      if (modal.selectedUids.includes(uid)) {
        modal.selectedUids = modal.selectedUids.filter(u => u !== uid);
      } else {
        modal.selectedUids.push(uid);
      }
      render();
    };
  });
  document.querySelectorAll("[data-own-char]").forEach(button => {
    button.onclick = () => { modal.selectedCharacterUid = button.dataset.ownChar; render(); };
  });
  document.querySelectorAll("[data-any-char]").forEach(button => {
    button.onclick = () => { modal.selectedCharacterUid = button.dataset.anyChar; render(); };
  });
  document.querySelectorAll("[data-own-available-char]").forEach(button => {
    button.onclick = () => { modal.selectedCharacterUid = button.dataset.ownAvailableChar; render(); };
  });
  document.querySelectorAll("[data-discard-one]").forEach(button => {
    button.onclick = () => { modal.selectedUid = button.dataset.discardOne; render(); };
  });
  document.querySelectorAll("[data-liuzhizhi-target]").forEach(button => {
    button.onclick = () => {
      modal.selectedTarget = button.dataset.liuzhizhiTarget;
      modal.selectedCardUid = null;
      const target = game.players.find(p => p.memberId === modal.selectedTarget);
      modal.cards = (target?.hand || []).filter(c => {
        const def = skillDefinition(c.cardId);
        return def && (def.rarity === "white" || def.rarity === "green");
      });
      render();
    };
  });
  document.querySelectorAll("[data-liuzhizhi-card]").forEach(button => {
    button.onclick = () => { modal.selectedCardUid = button.dataset.liuzhizhiCard; render(); };
  });
  document.querySelectorAll("[data-ability-discard]").forEach(button => {
    button.onclick = () => {
      const uid = button.dataset.abilityDiscard;
      if (modal.selectedUids.includes(uid)) {
        modal.selectedUids = modal.selectedUids.filter(u => u !== uid);
      } else if (modal.selectedUids.length < 3) {
        modal.selectedUids.push(uid);
      }
      render();
    };
  });
  document.querySelectorAll("[data-effort-char]").forEach(button => {
    button.onclick = () => { modal.selectedCharacterUid = button.dataset.effortChar; modal.selectedDimension = null; render(); };
  });
  document.querySelectorAll("[data-effort-dim]").forEach(button => {
    button.onclick = () => { modal.selectedDimension = button.dataset.effortDim; render(); };
  });
  document.querySelectorAll("[data-motion-points]").forEach(button => {
    button.onclick = () => {
      ui.modal = null;
      sendGameAction("ACTIVATE_CHARACTER", {
        characterId: modal.characterId,
        abilityId: modal.abilityId,
        abstractPoints: Number(button.dataset.motionPoints)
      });
    };
  });
  document.querySelectorAll("[data-toggle-dimension]").forEach(button => {
    button.onclick = () => {
      const dimension = button.dataset.toggleDimension;
      const maxDimensions = modal.kind === "two-dimensions" ? 2 : 3;
      modal.selected = modal.selected.includes(dimension)
        ? modal.selected.filter(item => item !== dimension)
        : modal.selected.length < maxDimensions ? [...modal.selected, dimension] : modal.selected;
      render();
    };
  });
  document.querySelectorAll("[data-toggle-target]").forEach(button => {
    button.onclick = () => {
      const targetId = button.dataset.toggleTarget;
      modal.selected = modal.selected.includes(targetId)
        ? modal.selected.filter(item => item !== targetId)
        : modal.selected.length < 2 ? [...modal.selected, targetId] : modal.selected;
      render();
    };
  });
  document.querySelectorAll("[data-event-character]").forEach(button => {
    button.onclick = () => { modal.selectedCharacterUid = button.dataset.eventCharacter; render(); };
  });
  document.querySelectorAll("[data-event-target]").forEach(button => {
    button.onclick = () => { modal.selectedTargetMemberId = button.dataset.eventTarget; render(); };
  });
  document.querySelectorAll("[data-event-decision]").forEach(button => {
    button.onclick = () => { modal.decision = button.dataset.eventDecision; modal.selectedCharacterUid = null; render(); };
  });
  document.querySelectorAll("[data-event-resp-character]").forEach(button => {
    button.onclick = () => { modal.selectedCharacterUid = button.dataset.eventRespCharacter; render(); };
  });
  document.querySelectorAll("[data-restore-character]").forEach(button => {
    button.onclick = () => { modal.selectedCharacterUid = button.dataset.restoreCharacter; render(); };
  });
  document.querySelectorAll("[data-star-decision]").forEach(button => {
    button.onclick = () => {
      ui.modal = null;
      sendGameAction("RESOLVE_STAR_MITIGATION", { accept: button.dataset.starDecision === "accept" });
    };
  });
  document.getElementById("confirm-modal")?.addEventListener("click", () => {
    ui.modal = null;
    if (modal.kind === "skill-own-dimension") {
      sendGameAction("PLAY_CARD", { cardUid: modal.cardUid, dimension: modal.selectedDimension });
    } else if (modal.kind === "skill-player-dimension") {
      sendGameAction("PLAY_CARD", { cardUid: modal.cardUid, targetMemberId: modal.selectedTarget, dimension: modal.selectedDimension });
    } else if (modal.kind === "skill-own-opponent-characters") {
      sendGameAction("PLAY_CARD", { cardUid: modal.cardUid, ownCharacterUid: modal.selectedOwnUid, targetCharacterUids: modal.selectedOpponentUids });
    } else if (modal.kind === "skill-own-character") {
      sendGameAction("PLAY_CARD", { cardUid: modal.cardUid, characterUid: modal.selectedCharacterUid });
    } else if (modal.kind === "skill-own-available-character") {
      sendGameAction("PLAY_CARD", { cardUid: modal.cardUid, characterUid: modal.selectedCharacterUid });
    } else if (modal.kind === "skill-any-character") {
      sendGameAction("PLAY_CARD", { cardUid: modal.cardUid, characterUid: modal.selectedCharacterUid });
    } else if (modal.kind === "skill-own-character-dimension") {
      sendGameAction("PLAY_CARD", { cardUid: modal.cardUid, characterUid: modal.selectedCharacterUid, dimension: modal.selectedDimension });
    } else if (modal.kind === "skill-discard-cards") {
      sendGameAction("PLAY_CARD", { cardUid: modal.cardUid, discardUids: modal.selectedUids });
    } else if (modal.kind === "skill-discard-one") {
      sendGameAction("PLAY_CARD", { cardUid: modal.cardUid, discardUid: modal.selectedUid });
    } else if (modal.kind === "event-choose") {
      sendGameAction("RESOLVE_EVENT", {
        ownCharacterUid: modal.selectedCharacterUid,
        targetMemberId: modal.selectedTargetMemberId
      });
    } else if (modal.kind === "event-response") {
      const payload = { decision: modal.decision };
      if (modal.decision === "accept") payload.targetCharacterUid = modal.selectedCharacterUid;
      sendGameAction("RESOLVE_EVENT", payload);
    } else if (modal.kind === "restore-character") {
      sendGameAction("RESTORE_CHARACTER", { characterUid: modal.selectedCharacterUid });
    } else if (modal.kind === "three-dimensions" || modal.kind === "two-dimensions") {
      sendGameAction("ACTIVATE_CHARACTER", {
        characterId: modal.characterId,
        abilityId: modal.abilityId,
        dimensions: modal.selected
      });
    } else if (modal.kind === "up-to-two-targets") {
      sendGameAction("ACTIVATE_CHARACTER", {
        characterId: modal.characterId,
        abilityId: modal.abilityId,
        targetMemberIds: modal.selected
      });
    } else if (modal.kind === "ability-opponent-card") {
      sendGameAction("ACTIVATE_CHARACTER", {
        characterId: modal.characterId,
        abilityId: modal.abilityId,
        targetMemberId: modal.selectedTarget,
        targetCardUid: modal.selectedCardUid
      });
    } else if (modal.kind === "ability-discard-cards") {
      sendGameAction("ACTIVATE_CHARACTER", {
        characterId: modal.characterId,
        abilityId: modal.abilityId,
        discardUids: modal.selectedUids
      });
    }
  });
  document.querySelectorAll("[data-review-target]").forEach(button => {
    button.onclick = () => {
      ui.modal = null;
      sendGameAction("REVIEW_VOTE", {
        targetMemberId: button.dataset.reviewTarget,
        vote: button.dataset.vote
      });
    };
  });
  document.querySelectorAll("[data-arithmetic-answer]").forEach(button => {
    button.onclick = () => {
      ui.modal = null;
      clearTimeout(ui.arithmeticTimer);
      sendGameAction("ANSWER_ARITHMETIC", { selectedIndex: Number(button.dataset.arithmeticAnswer) });
    };
  });
  document.querySelectorAll("[data-ability-rarity]").forEach(button => {
    button.onclick = () => {
      const { characterId, abilityId } = modal;
      ui.modal = null;
      sendGameAction("ACTIVATE_CHARACTER", { characterId, abilityId, rarity: button.dataset.abilityRarity });
    };
  });
  document.querySelectorAll("[data-ability-peak-dim]").forEach(button => {
    button.onclick = () => {
      const { characterId, abilityId } = modal;
      ui.modal = null;
      sendGameAction("ACTIVATE_CHARACTER", { characterId, abilityId, dimension: button.dataset.abilityPeakDim });
    };
  });
  document.querySelectorAll("[data-seven-trace-pick]").forEach(button => {
    button.onclick = () => {
      ui.modal = null;
      sendGameAction("SEVEN_TRACE_PICK", { cardUid: button.dataset.sevenTracePick });
    };
  });
}

function renderSettlement() {
  const ranking = game?.ranking || [];
  const topScore = ranking[0]?.score;
  const winners = ranking.filter(item => item.score === topScore).map(item => item.name);
  app.innerHTML = `
    ${topbar("结算", `<span class="state-pill">SETTLEMENT</span>`)}
    ${renderGlobalModifierBanner()}
    <div class="settlement">
      <div class="winner"><div class="winner-label">${winners.length > 1 ? "并列冠军" : "冠军"}</div><div class="winner-name">${escapeHtml(winners.join("、"))}</div></div>
      <div class="ranking">${ranking.map((item, index) => `<div class="rank-row">
        <div class="rank-pos">${index + 1}</div>
        <div><div class="rank-name">${escapeHtml(item.name)}</div><div class="rank-detail">选曲5% · 配置40% · 抽象20% · 具象20% · 创新15% · 声望 ${item.reputation}${item.storyboard ? " · 故事板+5" : ""}${item.settlementPenalty ? ` · ${item.settlementPenalty}` : ""}</div></div>
        <div class="rank-score">${item.score}</div>
      </div>`).join("")}</div>
      ${room.isHost
        ? `<button class="btn primary full" id="back-lobby">${icon("rotate-ccw", 15)} 返回房间大厅</button>`
        : '<div class="notice">等待房主返回房间大厅。</div>'}
    </div>`;
  bindTopbar();
  document.getElementById("back-lobby")?.addEventListener("click", () => sendRoomAction("BACK_TO_LOBBY"));
}

function renderChatPanel() {
  const isMuted = ui.mutedPlayerIds.has(room.myId);
  const unreadCount = ui.chatMessages.length;
  const messagesHtml = ui.chatMessages.slice(-50).filter(msg => {
    if (msg.type === "system") return true;
    return msg.senderId === room.myId || !isPlayerBlocked(msg.senderId);
  }).map(msg => {
    if (msg.type === "system") {
      return `<div class="chat-msg system"><span class="chat-text">${escapeHtml(msg.text)}</span></div>`;
    }
    const isSelf = msg.senderId === room.myId;
    const senderClass = isSelf ? "self" : (msg.isSpectator ? "spectator" : "");
    const senderLabel = msg.isSpectator ? `[观战] ${escapeHtml(msg.senderName)}` : escapeHtml(msg.senderName);
    const blockBtn = isSelf ? "" : `<button class="chat-block-btn" data-block-id="${escapeHtml(msg.senderId)}" title="${isPlayerBlocked(msg.senderId) ? "取消屏蔽" : "屏蔽"}">${icon(isPlayerBlocked(msg.senderId) ? "eye" : "eye-off", 10)}</button>`;
    return `<div class="chat-msg"><span class="chat-sender ${senderClass}">${senderLabel}:</span> <span class="chat-text">${escapeHtml(msg.content)}</span>${blockBtn}</div>`;
  }).join("");
  app.insertAdjacentHTML("beforeend", `
    <div class="chat-panel ${ui.chatOpen ? "" : "collapsed"}" id="chat-panel">
      <div class="chat-header" id="chat-header">
        <span class="chat-title">${icon("message-circle", 14)} 聊天</span>
        <span class="chat-toggle">${ui.chatOpen ? "▼" : "▲"}${unreadCount > 0 && !ui.chatOpen ? `<span class="chat-badge">${unreadCount}</span>` : ""}</span>
      </div>
      ${ui.chatOpen ? `
        <div class="chat-messages" id="chat-messages">${messagesHtml}</div>
        <div class="chat-quick">
          ${QUICK_PHRASES.map(p => `<button class="chat-quick-btn" data-phrase="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join("")}
        </div>
        ${isMuted ? '<div class="chat-muted-notice">你已被房主禁言</div>' : `
        <div class="chat-input-row">
          <input type="text" id="chat-input" placeholder="输入消息..." maxlength="${CHAT_MAX_LENGTH}" value="${escapeHtml(ui.chatInput)}" />
          <button id="chat-send">${icon("send", 14)}</button>
        </div>`}
      ` : ""}
    </div>
  `);
  const header = document.getElementById("chat-header");
  if (header) header.onclick = () => {
    ui.chatOpen = !ui.chatOpen;
    render();
  };
  if (ui.chatOpen) {
    const msgContainer = document.getElementById("chat-messages");
    if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
    const input = document.getElementById("chat-input");
    if (input) {
      input.oninput = () => { ui.chatInput = input.value; };
      input.onkeydown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendChat(input.value);
          ui.chatInput = "";
          input.value = "";
        }
      };
    }
    const sendBtn = document.getElementById("chat-send");
    if (sendBtn) sendBtn.onclick = () => {
      const inp = document.getElementById("chat-input");
      sendChat(inp.value);
      ui.chatInput = "";
      inp.value = "";
      inp.focus();
    };
    document.querySelectorAll(".chat-quick-btn").forEach(btn => {
      btn.onclick = () => {
        sendChat(btn.dataset.phrase);
        input.focus();
      };
    });
    document.querySelectorAll(".chat-block-btn").forEach(btn => {
      btn.onclick = () => toggleBlockPlayer(btn.dataset.blockId);
    });
  }
}

function renderRulesModal() {
  app.insertAdjacentHTML("beforeend", `<div class="modal"><div class="modal-box rules-dialog">
    <div class="modal-head"><h3>规则摘要</h3><button class="btn icon-only small" id="close-rules" title="关闭">${icon("x", 15)}</button></div>
    <p class="modal-desc">目标是让自己的谱面在OthPecJam中夺得冠军。历时设定回合数后，谱面综合评分最高的玩家获胜。</p>
    <ol>
      <li><strong>购置：</strong>每人12点，按S/A+/A/B+/B/C支付6/5/4/3/2/1点，不可重复购置同一角色。</li>
      <li><strong>开局：</strong>所有玩家轮流购置角色，然后从技能卡池抽取5张技能牌。</li>
      <li><strong>回合：</strong>第2轮起，每轮必须且只能摸1张牌；自己的轮次可发动角色技能和技能牌。</li>
      <li><strong>第1轮：</strong>每位玩家能且只能发动1次角色技能，不摸牌且不能使用技能牌；所用角色决定初始选曲品味，限制他人角色技能的效果无效。</li>
      <li><strong>事件牌：</strong>不进入手牌，摸到后强制触发，并重新回到卡池。</li>
      <li><strong>结算：</strong>选曲品味5%、配置水平40%、抽象动效20%、具象动效20%、创新程度15%；属性值在结算时加入总分，且可以为负。</li>
      <li><strong>房间：</strong>人数大于1人即可开始；开局后加入的成员只能观战，本局结束后再加入玩家列表。</li>
    </ol>
    <h4>事件牌</h4>
    <div class="modal-desc">${EVENT_CARDS.map(card => `<p><strong>${escapeHtml(card.name)}</strong>：${escapeHtml(card.description)}</p>`).join("")}</div>
    <h4>全局状态（可选玩法）</h4>
    <div class="modal-desc">${GLOBAL_MODIFIERS.map(modifier => `<p><strong>${escapeHtml(modifier.name)}</strong>：${escapeHtml(modifier.description)}</p>`).join("")}</div>
    <h4>技能牌</h4>
    <div class="modal-desc">${SKILL_CARDS.map(card => `<p><strong>${escapeHtml(card.name)}</strong>：${escapeHtml(card.description)}</p>`).join("")}</div>
  </div></div>`);
  document.getElementById("close-rules").onclick = () => { ui.rulesOpen = false; render(); };
}

