"use strict";

function totalScore(player) {
  if (player.frozen && player.frozenScore != null) return player.frozenScore;
  let score = DIMENSIONS.reduce((sum, dim) => sum + player.scores[dim] * SCORE_WEIGHTS[dim], 0);
  if (ownsCharacter(player, "sulfur")) {
    score += (player.scores.abstract + player.scores.concrete) * .075;
  }
  score += player.reputation;
  if (player.storyboard) score += player.storyboardBonus || 5;
  score += player.settlementPenalty || 0;
  return roundScore(score);
}

function roomPlayers() {
  return room.members.filter(member => !member.spectator);
}

function myMember() {
  return room.members.find(member => member.id === room.myId) || null;
}

function myGamePlayer() {
  return game?.players.find(player => player.memberId === room.myId) || null;
}

function currentPlayer() {
  return game?.players[game.currentPlayerIndex] || null;
}

function isMyTurn() {
  return Boolean(game && currentPlayer()?.memberId === room.myId && game.phase !== GAME_PHASE.SETTLEMENT);
}

function isSpectator() {
  return Boolean(myMember()?.spectator || (game && !myGamePlayer()));
}

function characterStats(characterId) {
  const def = characterDefinition(characterId);
  if (!def) return null;
  if (game?.globalModifier === "wakeup" && game.adjustedCharacterStats?.[characterId]) {
    return game.adjustedCharacterStats[characterId];
  }
  return def.stats;
}

function globalModifierActive(id) {
  return game?.globalModifier === id;
}

function createDeck() {
  const connectedCount = roomPlayers().filter(member => member.connected).length;
  const events = EVENT_CARDS.filter(card => {
    if (card.id === "tribunal" && connectedCount < 4) return false;
    if (globalModifierActive("loyalty") && (card.id === "retire" || card.id === "rpe")) return false;
    return true;
  });
  // 稀有事件牌权重为普通事件牌的 1/5：普通事件 5 份，稀有事件 1 份。
  // 舞萌/中二/音击需要多步交互，概率过高会频繁打断流程，同样按 1 份处理。
  const lowFrequencyEvents = new Set(["maimai", "chunithm", "ongeki"]);
  const eventCards = [];
  events.forEach(card => {
    const copies = card.isRare || lowFrequencyEvents.has(card.id) ? 1 : 5;
    for (let i = 0; i < copies; i++) eventCards.push(createCard("event", card.id));
  });
  // 牌堆构成：30%事件牌 + 70%技能牌
  // 事件牌约72张（普通14×5 + 稀有2×1），技能牌33×5=165张，总计约237张
  // 事件牌占比 72/237 ≈ 30.4%，技能牌占比 165/237 ≈ 69.6%
  // 技能牌稀有度仍由 drawSkillFromPool 中的 weightedSkillCard 维持
  const skillCards = [];
  SKILL_CARDS.forEach(card => {
    if (card.special) return;
    for (let i = 0; i < 5; i++) skillCards.push(createCard("skill", card.id));
  });
  return shuffle([...skillCards, ...eventCards]);
}

function createCard(type, cardId) {
  return { type, cardId, uid: `${type === "skill" ? "s" : "e"}_${cryptoRandom(8)}` };
}

function createStarCard() {
  return { type: "star", cardId: "star", uid: `star_${cryptoRandom(8)}` };
}

function offsetReductionWithStars(player, totalReduction) {
  if (!player || totalReduction <= 0) return totalReduction;
  const perStar = Math.floor((player.scores.concrete || 0) / 8);
  if (perStar <= 0) return totalReduction;
  let remaining = totalReduction;
  while (remaining > 0) {
    const starIdx = player.hand.findIndex(c => c.type === "star");
    if (starIdx < 0) break;
    player.hand.splice(starIdx, 1);
    remaining -= perStar;
    appendLog(`${player.name} 弃置一张【星】以抵消减分。`, "effect");
  }
  player.handCount = player.hand.length;
  return Math.max(0, remaining);
}

function resolveStarMitigation(memberId, accept) {
  const pending = game.pendingStarMitigation;
  if (!pending || pending.memberId !== memberId) return fail("没有待处理的减分抵消");
  const playerIndex = game.players.findIndex(p => p.memberId === memberId);
  if (playerIndex < 0) return fail("玩家不存在");
  const player = game.players[playerIndex];
  const total = pending.reductions.reduce((sum, r) => sum + r.amount, 0);
  let remaining = total;
  if (accept) {
    remaining = offsetReductionWithStars(player, total);
  }
  game.pendingStarMitigation = null;
  let toApply = remaining;
  for (const r of pending.reductions) {
    if (toApply <= 0) break;
    const applyAmount = Math.min(r.amount, toApply);
    applyScoreChange(playerIndex, r.dimension, -applyAmount, { sourcePlayerIndex: playerIndex, skipCrossing: true, skipStarPending: true });
    toApply -= applyAmount;
  }
  appendLog(`${player.name} ${accept ? "接受" : "拒绝"}【星】抵消，剩余减分${remaining}点。`, "effect");
  return ok();
}

function createGameState(members, totalRounds, globalModifier = null) {
  const activeMembers = members.filter(member => !member.spectator && member.connected);
  const orderedMembers = shuffle([...activeMembers]);
  const initialFunds = globalModifier === "cooperation" ? 15 : globalModifier === "restraint" ? 10 : 12;
  const initialReputation = globalModifier === "pure" ? 0 : 50;
  const adjustedCharacterStats = {};
  if (globalModifier === "wakeup") {
    CHARACTERS.forEach(character => {
      const multiplier = GLOBAL_WAKEUP_MULTIPLIERS[character.rarity] ?? 1;
      const stats = {};
      CHARACTER_STATS.forEach(stat => {
        stats[stat] = Math.ceil(character.stats[stat] * multiplier);
      });
      adjustedCharacterStats[character.id] = stats;
    });
  }
  return {
    phase: GAME_PHASE.DRAFT,
    totalRounds,
    globalModifier,
    adjustedCharacterStats,
    twoZeroDisabled: false,
    rouletteFinalRound: null,
    round: 0,
    currentPlayerIndex: 0,
    draftDone: [],
    turn: {
      hasDrawn: false,
      skillCardsPlayed: 0,
      usedAbilityIds: [],
      unsafeZonePlayedBy: [],
      brilliantReplayed: false,
      number: 0
    },
    players: orderedMembers.map(member => ({
      memberId: member.id,
      name: member.name,
      isBot: Boolean(member.isBot),
      difficulty: member.difficulty || "simple",
      aiStrategy: member.aiStrategy || randomItem(["config", "motion", "innovation", "selection"]),
      hand: [],
      handCount: 0,
      handLimit: 5,
      characters: [],
      funds: initialFunds,
      scores: { selection: 0, config: 0, abstract: 0, concrete: 0, innovation: 0 },
      reputation: initialReputation,
      disableCharacterTurns: 0,
      disableAllSkillTurns: 0,
      disableUntilOwnTurn: false,
      firstRoundSkillUsed: false,
      retiredCharacterCount: 0,
      pendingDisableCharacterTurns: 0,
      pendingSkillCardLimit: null,
      skillCardLimit: null,
      extraTurnCredits: 0,
      extraTurnEligibleAfter: null,
      storyboard: false,
      storyboardBonus: 0,
      frozen: false,
      frozenScore: null,
      commissionLocked: false,
      commissionLockAtRound: null,
      reviewTurns: 0,
      reviewActionUsed: false,
      extraDrawNextTurn: 0,
      handExchangeCost: 1,
      settlementPenalty: 0,
      skipNextTurn: false,
      vitality: 0,
      overtureActive: false,
      overtureReduceUsed: false,
      overtureDiscardUsed: false,
      youSufferTurn: false,
      arithmeticPending: false,
      deificationPending: null,
      dunStiliToggle: false,
      worldTreeActive: false,
      worldTreeStartRound: 0,
      counters: {
        summercubeMotion: 0,
        jinyeDraws: 0,
        naoguiTriggered: false,
        disinfectantGain: 0,
        chiMahuConfig: 0,
        hotwindConfig: 0,
        twoThreeEightLoss: 0,
        ziweiHighest: {}
      },
      connected: true,
      disconnectedAt: 0,
      aiControlled: false,
      lastActionAt: Date.now()
    })),
    deck: createDeck(),
    discard: [],
    log: [],
    ranking: [],
    pendingEvent: null,
    forcePlay: false,
    turnDirection: 1,
    pecJamRestoreRound: null,
    unsafeZone: false,
    unsafeZoneUntilTurn: null,
    dystopia: null,
    dystopiaQueue: [],
    sevenTrace: null,
    skillHistory: [],
    overtureResetRound: 0,
    arithmetic: null,
    lastReduction: null,
    lastDiscard: null,
    sequence: 0,
    effectDepth: 0,
    createdAt: Date.now()
  };
}

function refillDeckIfNeeded() {
  if (game.deck.length || !game.discard.length) return;
  const regular = game.discard.filter(c => c.type !== "star");
  game.discard = [];
  game.deck = shuffle(regular);
  appendLog("抽牌堆已空，弃牌堆重新洗入抽牌堆（星不进入牌堆）。", "event");
}

function ownsCharacter(player, characterId) {
  return Boolean(player?.characters.some(instance => instance.id === characterId && !instance.permanentlyDisabled));
}

// 玩家「爆肝程度」：取已购置角色中 stamina 最高者（含 staminaBonus）
function playerMaxStamina(player) {
  if (!player?.characters?.length) return 0;
  return player.characters.reduce((max, instance) => {
    const stamina = (characterStats(instance.id)?.stamina || 0) + (instance.staminaBonus || 0);
    return Math.max(max, stamina);
  }, 0);
}


function characterSelection(character) {
  return character.stats.selection;
}

function gainReputation(playerIndex, amount, options = {}) {
  const player = game.players[playerIndex];
  if (!player || player.frozen || !amount) return 0;
  if (globalModifierActive("pure")) {
    const dimension = randomDimension(true);
    applyScoreChange(playerIndex, dimension, amount, {
      sourcePlayerIndex: playerIndex,
      allowSelectionChange: true
    });
    appendLog(`${player.name} 的声望变化转为${DIMENSION_LABELS[dimension]}${amount > 0 ? "+" : ""}${amount}。`, "effect");
    return amount;
  }
  const before = player.reputation;
  if (options.cap != null && amount > 0) {
    player.reputation = player.reputation >= options.cap
      ? player.reputation
      : Math.min(options.cap, player.reputation + amount);
  } else {
    player.reputation += amount;
  }
  return player.reputation - before;
}

function skillCardPointMultiplier(player) {
  return 1 + (player?.retiredCharacterCount || 0) * .5;
}

function handLimitOf(player) {
  if (!player || !player.characters.length) return 5;
  const totalStamina = player.characters.reduce((sum, character) => {
    return sum + (characterStats(character.id)?.stamina || 0);
  }, 0);
  return Math.ceil(totalStamina / player.characters.length + 5);
}

function recomputeHandLimit(player) {
  const limit = handLimitOf(player);
  player.handLimit = limit;
  return limit;
}

function discardCard(playerIndex, cardUid) {
  const player = game.players[playerIndex];
  if (!player) return fail("玩家不存在");
  const idx = player.hand.findIndex(c => c.uid === cardUid);
  if (idx < 0) return fail("手牌不存在");
  const [card] = player.hand.splice(idx, 1);
  game.discard.push(card);
  player.handCount = player.hand.length;
  game.lastDiscard = { playerIndex, cardUid: card.uid, cardId: card.cardId, turn: game.turn.number };
  const name = skillDefinition(card.cardId)?.name || "牌";
  game.turn.playableCards = Math.max(0, (game.turn.playableCards ?? player.handLimit) - 1);
  handleNonPlayCardLoss(playerIndex, 1);
  appendLog(`${player.name} 主动弃置了「${name}」，本回合可打出的牌数-1。`, "effect");
  return ok();
}

function needsTargetSelection(definition) {
  if (!definition) return false;
  if (definition.targetMode && definition.targetMode !== TARGET_MODE.NONE) return true;
  return definition.target === "opponent";
}

function discardOverflowCard(playerIndex, cardUid) {
  const player = game.players[playerIndex];
  const idx = player.hand.findIndex(c => c.uid === cardUid);
  if (idx < 0) return;
  const [card] = player.hand.splice(idx, 1);
  game.discard.push(card);
}

function forcePlayCard(playerIndex, cardUid) {
  const player = game.players[playerIndex];
  const card = player.hand.find(c => c.uid === cardUid);
  if (!card || card.type === "star") { discardOverflowCard(playerIndex, cardUid); return; }
  const definition = skillDefinition(card.cardId);
  if (!definition || needsTargetSelection(definition)) {
    discardOverflowCard(playerIndex, cardUid);
    if (definition) appendLog(`${player.name} 溢出的「${definition.name}」需要选择对象，弃置。`, "event");
    return;
  }
  const savedPlayed = game.turn.skillCardsPlayed;
  game.forcePlay = true;
  let result;
  try {
    result = executeSkillCard(playerIndex, cardUid, {});
  } finally {
    game.forcePlay = false;
    game.turn.skillCardsPlayed = savedPlayed;
  }
  if (!result.ok) {
    discardOverflowCard(playerIndex, cardUid);
    appendLog(`${player.name} 强制打出「${definition.name}」失败，弃置：${result.reason}。`, "event");
  } else {
    appendLog(`${player.name} 因手牌溢出强制打出了「${definition.name}」。`, "event");
  }
}

function applyScoreChange(playerIndex, dimension, requestedAmount, context = {}) {
  const player = game.players[playerIndex];
  if (!player || !DIMENSIONS.includes(dimension) || !requestedAmount || player.frozen || player.commissionLocked || player.dimensionLocked || (player.programEffect && requestedAmount < 0)) return 0;
  if (dimension === "selection" && player.firstRoundSkillUsed && !context.allowSelectionChange) return 0;
  if (game.effectDepth > 40) return 0;

  let amount = requestedAmount;
  if (context.fromSkillCard) {
    const source = game.players[context.sourcePlayerIndex ?? playerIndex];
    amount *= skillCardPointMultiplier(source);
    if (amount < 0 && source && source.silencedAmplify) amount *= source.silencedAmplify;
  }
  if (amount > 0 && dimension === "concrete" && ownsCharacter(player, "ziyang")) {
    amount *= 2;
  }
  if (amount < 0 && dimension === "config" && ownsCharacter(player, "tokyo")) {
    const source = game.players[context.sourcePlayerIndex];
    if (source && source.memberId !== player.memberId) source.disableUntilOwnTurn = true;
    appendLog(`${player.name} 的配置水平减少被“地道东京爷”免疫。`, "effect");
    return 0;
  }
  if (amount > 0 && globalModifierActive("two-zero") && !game.twoZeroDisabled) {
    amount += 1;
  }
  if (!amount) return 0;

  // 反乌托邦：持续期间，减分先记录到待抵消队列（延迟生效）
  if (amount < 0 && game.dystopia && game.turn.number < game.dystopia.untilTurn && !context.skipDystopia) {
    game.dystopiaQueue.push({ playerIndex, dimension, amount: Math.abs(amount), offset: false });
    appendLog(`「反乌托邦」：${player.name} 的${DIMENSION_LABELS[dimension]}减分${Math.abs(amount)}点被记录到待抵消队列。`, "event");
    return 0;
  }

  if (amount < 0 && player.hand.some(c => c.type === "star") && !context.skipStarPending) {
    if (!game.pendingStarMitigation || game.pendingStarMitigation.memberId !== player.memberId) {
      game.pendingStarMitigation = { memberId: player.memberId, reductions: [] };
    }
    game.pendingStarMitigation.reductions.push({ dimension, amount: Math.abs(amount) });
    return 0;
  }

  const beforeAll = game.players.map(candidate => candidate.scores[dimension]);
  player.scores[dimension] += amount;
  if (amount < 0) {
    game.lastReduction = { playerIndex, dimension, amount: Math.abs(amount), turn: game.turn.number };
  }
  // 不安全领域：减分时50%概率随机弃一张手牌
  if (amount < 0 && game.unsafeZone && game.turn.number < game.unsafeZoneUntilTurn && player.hand.length > 0 && Math.random() < 0.5) {
    const idx = Math.floor(Math.random() * player.hand.length);
    const [dropped] = player.hand.splice(idx, 1);
    game.discard.push(dropped);
    player.handCount = player.hand.length;
    appendLog(`「不安全领域」：${player.name} 受到减分，随机弃置一张手牌。`, "event");
  }
  // 钝斯提李被动：维度有效变化且仅涉及1个维度时，抽象动效与创新能力各+1（直接改值防递归）
  if (amount !== 0 && ownsCharacter(player, "dun-stili") && !context.skipDunStili) {
    player.scores.abstract += 1;
    player.scores.innovation += 1;
    appendLog(`${player.name} 的「钝斯提李」被动触发：抽象动效+1、创新能力+1。`, "effect");
  }
  game.effectDepth++;
  runScorePassives(playerIndex, dimension, amount, beforeAll, context);
  game.effectDepth--;
  return amount;
}

function setScore(playerIndex, dimension, value, context = {}) {
  const player = game.players[playerIndex];
  if (!player) return 0;
  return applyScoreChange(playerIndex, dimension, value - player.scores[dimension], context);
}

function runScorePassives(playerIndex, dimension, amount, beforeAll, context) {
  const player = game.players[playerIndex];
  const sourceIndex = Number.isInteger(context.sourcePlayerIndex) ? context.sourcePlayerIndex : playerIndex;
  const source = game.players[sourceIndex];

  if (amount < 0) {
    game.players.forEach((owner, ownerIndex) => {
      if (ownsCharacter(owner, "jinye") && owner.counters.jinyeDraws < 2) {
        owner.counters.jinyeDraws++;
        drawCards(ownerIndex, 1, true);
        appendLog(`${owner.name} 因场上能力值降低抽1张牌。`, "effect");
      }
    });
  }

  if (amount > 0 && source && sourceIndex !== playerIndex && ownsCharacter(source, "ruishi")) {
    gainReputation(sourceIndex, 1);
    appendLog(`${source.name} 因使其他玩家维度增长获得1点声望。`, "effect");
  }

  if (amount > 0 && (dimension === "abstract" || dimension === "concrete") && ownsCharacter(player, "summercube")) {
    player.counters.summercubeMotion += amount;
    while (player.counters.summercubeMotion >= 15) {
      player.counters.summercubeMotion -= 15;
      applyScoreChange(playerIndex, "config", 3, { sourcePlayerIndex: playerIndex, skipCrossing: true });
      appendLog(`${player.name} 累计提高15点动效，配置水平+3。`, "effect");
    }
  }

  if (amount > 0 && ownsCharacter(player, "naogui") && !player.counters.naoguiTriggered) {
    player.counters.naoguiTriggered = true;
    drawCards(playerIndex, 1, true);
    appendLog(`${player.name} 因能力值提升抽1张牌。`, "effect");
  }

  if (amount > 0 && dimension === "innovation" && ownsCharacter(player, "furry")) {
    drawCards(playerIndex, 1, true);
    appendLog(`${player.name} 因创新能力增加抽1张牌。`, "effect");
  }

  if (amount > 0 && ownsCharacter(player, "disinfectant")) {
    player.counters.disinfectantGain += amount;
    while (player.counters.disinfectantGain >= 10) {
      player.counters.disinfectantGain -= 10;
      drawCards(playerIndex, 2, true);
      appendLog(`${player.name} 累计提升10点能力值，抽2张牌。`, "effect");
    }
  }

  if (ownsCharacter(player, "chi-mahu") && sourceIndex !== playerIndex && player.counters.chiMahuRepTurn !== game.turn.number) {
    player.counters.chiMahuRepTurn = game.turn.number;
    gainReputation(playerIndex, 1);
    appendLog(`${player.name} 的维度被其他玩家改变，获得1点声望。`, "effect");
  }

  if (amount > 0 && dimension === "config" && ownsCharacter(player, "hotwind")) {
    player.counters.hotwindConfig += amount;
    while (player.counters.hotwindConfig >= 5) {
      player.counters.hotwindConfig -= 5;
      gainReputation(playerIndex, 1);
      appendLog(`${player.name} 累计提升5点配置水平，获得1点声望。`, "effect");
    }
  }

  if (!context.skipCrossing) runCrossingPassives(playerIndex, dimension, beforeAll);
}

function runCrossingPassives(playerIndex, dimension, beforeAll) {
  const player = game.players[playerIndex];
  const afterValue = player.scores[dimension];

  if (ownsCharacter(player, "ftayo")) {
    game.players.forEach((opponent, opponentIndex) => {
      if (opponentIndex === playerIndex) return;
      if (beforeAll[playerIndex] <= beforeAll[opponentIndex] && afterValue > opponent.scores[dimension]) {
        const targetIndex = randomItem(game.players.map((_, index) => index).filter(index => index !== playerIndex));
        const targetDimension = randomDimension();
        applyScoreChange(targetIndex, targetDimension, -2, { sourcePlayerIndex: playerIndex, skipCrossing: true });
        appendLog(`${player.name} 的维度超过对手，随机对手的${DIMENSION_LABELS[targetDimension]}-2。`, "effect");
      }
    });
  }

  game.players.forEach((ftayoOwner, ownerIndex) => {
    if (ownerIndex === playerIndex || !ownsCharacter(ftayoOwner, "ftayo")) return;
    if (beforeAll[playerIndex] <= beforeAll[ownerIndex] && afterValue > ftayoOwner.scores[dimension]) {
      drawCards(ownerIndex, 1, true);
      appendLog(`${ftayoOwner.name} 的维度被对手超过，抽1张牌。`, "effect");
    }
  });

  if (ownsCharacter(player, "ziwei") && !player.counters.ziweiHighest[dimension]) {
    const wasHighest = beforeAll.every((value, index) => index === playerIndex || beforeAll[playerIndex] > value);
    const isHighest = game.players.every((candidate, index) => index === playerIndex || afterValue >= candidate.scores[dimension]);
    if (!wasHighest && isHighest) {
      player.counters.ziweiHighest[dimension] = true;
      drawCards(playerIndex, 2, true);
      const bonusDimension = randomDimension();
      applyScoreChange(playerIndex, bonusDimension, 5, { sourcePlayerIndex: playerIndex });
      appendLog(`${player.name} 的${DIMENSION_LABELS[dimension]}成为全场最高，抽2张牌且随机维度+5。`, "effect");
    }
  }
}

function characterEntryByUid(uid) {
  for (let playerIndex = 0; playerIndex < game.players.length; playerIndex++) {
    const player = game.players[playerIndex];
    const characterIndex = player.characters.findIndex(character => character.uid === uid);
    if (characterIndex >= 0) {
      return {
        player,
        playerIndex,
        character: player.characters[characterIndex],
        characterIndex
      };
    }
  }
  return null;
}

function disableRandomCharacterPermanently(playerIndex, eventName) {
  const player = game.players[playerIndex];
  const available = player?.characters.filter(character => !character.permanentlyDisabled) || [];
  if (!available.length) {
    appendLog(`${player?.name || "玩家"} 触发「${eventName}」，但没有可退坑的角色。`, "event");
    return null;
  }
  const character = randomItem(available);
  character.permanentlyDisabled = true;
  appendLog(`${player.name} 触发「${eventName}」：${characterDefinition(character.id).name}退坑，技能永久失效。`, "event");
  return character;
}

function triggerCanadaEventPassive() {
  game.players.forEach((owner, ownerIndex) => {
    if (!ownsCharacter(owner, "canada-goose")) return;
    const dimension = randomDimension(true);
    applyScoreChange(ownerIndex, dimension, 8, {
      sourcePlayerIndex: ownerIndex,
      allowSelectionChange: true
    });
    appendLog(`${owner.name} 因事件牌发动，${DIMENSION_LABELS[dimension]}+8。`, "effect");
  });
}

function createPendingEvent(eventId, actorIndex, stage = "choose") {
  const actor = game.players[actorIndex];
  game.pendingEvent = {
    id: `pending_${cryptoRandom(8)}`,
    eventId,
    actorIndex,
    stage,
    responderMemberId: actor.memberId
  };
}

function resolveEvent(playerIndex, card) {
  const player = game.players[playerIndex];
  const event = eventDefinition(card.cardId);
  if (!player || !event) return;

  if (ownsCharacter(player, "cherry")) {
    appendLog(`${player.name} 的“樱桃喝酒人”使事件牌「${event.name}」不产生效果。`, "event");
  } else if (event.id === "meeting") {
    if (Math.random() < .9) {
      DIMENSIONS.forEach(dim => applyScoreChange(playerIndex, dim, 1, {
        sourcePlayerIndex: playerIndex,
        allowSelectionChange: true
      }));
      appendLog(`${player.name} 触发「面基」：所有维度+1。`, "event");
    } else {
      player.disableCharacterTurns = Math.max(player.disableCharacterTurns, 1);
      appendLog(`${player.name} 触发「面基」：1回合无法发动角色牌技能。`, "event");
    }
  } else if (event.id === "recruit") {
    const available = player.characters.filter(instance => !instance.permanentlyDisabled);
    if (available.length) {
      const strongest = available
        .map(instance => ({
          instance,
          definition: characterDefinition(instance.id),
          value: CHARACTER_STATS.reduce((sum, stat) => sum + characterStats(instance.id)[stat], 0)
        }))
        .sort((a, b) => b.value - a.value || a.definition.name.localeCompare(b.definition.name, "zh-CN"))[0].instance;
      strongest.permanentlyDisabled = true;
      strongest.recruited = true;
      gainReputation(playerIndex, 15);
      appendLog(`${player.name} 触发「招安」：${characterDefinition(strongest.id).name}永久失效，声望+15。`, "event");
    } else {
      gainReputation(playerIndex, 15);
      appendLog(`${player.name} 触发「招安」：没有可禁用的角色，声望+15。`, "event");
    }
  } else if (event.id === "retire") {
    if (disableRandomCharacterPermanently(playerIndex, "退坑")) {
      player.retiredCharacterCount++;
      appendLog(`${player.name} 的技能牌点数效果变为×${skillCardPointMultiplier(player)}。`, "effect");
    }
  } else if (event.id === "new-draft") {
    ["config", "abstract", "concrete", "innovation"].forEach(dimension => {
      applyScoreChange(playerIndex, dimension, 1, { sourcePlayerIndex: playerIndex });
    });
    player.pendingDisableCharacterTurns = Math.max(player.pendingDisableCharacterTurns, 2);
    appendLog(`${player.name} 触发「新稿」：四个维度各+1，后两回合角色技能禁用。`, "event");
  } else if (event.id === "inspiration") {
    const dimension = randomDimension(true);
    const amount = 8 + Math.floor(Math.random() * 8);
    applyScoreChange(playerIndex, dimension, amount, {
      sourcePlayerIndex: playerIndex,
      allowSelectionChange: true
    });
    appendLog(`${player.name} 触发「灵光乍现！」：${DIMENSION_LABELS[dimension]}+${amount}。`, "event");
  } else if (event.id === "god-chart") {
    game.players.forEach((_, index) => drawCards(index, 2, true));
    appendLog(`${player.name} 触发「神谱发布！」：所有玩家抽2张技能牌。`, "event");
  } else if (event.id === "pecjam") {
    game.pecJamRestoreRound = game.round + 1;
    appendLog(`${player.name} 触发「PecJam」：下一轮所有角色牌恢复可用。`, "event");
  } else if (event.id === "maimai" || event.id === "chunithm" || event.id === "ongeki") {
    if (event.id === "ongeki") gainReputation(playerIndex, -1);
    createPendingEvent(event.id, playerIndex);
    appendLog(`${player.name} 触发「${event.name}」，等待选择。`, "event");
  } else if (event.id === "mind-shock") {
    const higherPlayers = game.players
      .map((candidate, index) => ({ candidate, index }))
      .filter(entry => entry.index !== playerIndex && totalScore(entry.candidate) > totalScore(player));
    if (!higherPlayers.length) {
      appendLog(`${player.name} 触发「心灵震慑」，但场上没有综合得分更高的玩家。`, "event");
    } else {
      const targetEntry = randomItem(higherPlayers);
      const target = targetEntry.candidate;
      const hasHigherDimension = DIMENSIONS.some(dimension => player.scores[dimension] > target.scores[dimension]);
      if (hasHigherDimension) {
        const targetHighest = Math.max(...DIMENSIONS.map(dimension => target.scores[dimension]));
        const dimension = randomItem(DIMENSIONS.filter(item => target.scores[item] === targetHighest));
        applyScoreChange(playerIndex, dimension, 1, {
          sourcePlayerIndex: playerIndex,
          allowSelectionChange: true
        });
        appendLog(`${player.name} 触发「心灵震慑」，与${target.name}比较后${DIMENSION_LABELS[dimension]}+1。`, "event");
      } else {
        const dimension = randomDimension(true);
        applyScoreChange(playerIndex, dimension, -1, {
          sourcePlayerIndex: playerIndex,
          allowSelectionChange: true
        });
        player.pendingSkillCardLimit = 3;
        appendLog(`${player.name} 触发「心灵震慑」，与${target.name}比较后${DIMENSION_LABELS[dimension]}-1，下回合最多打出3张技能牌。`, "event");
      }
    }
  } else if (event.id === "rpe") {
    if (globalModifierActive("two-zero")) game.twoZeroDisabled = true;
    game.players.forEach((target, targetIndex) => {
      const hasPeCharacter = target.characters.some(character => characterDefinition(character.id)?.isPE);
      if (hasPeCharacter) {
        appendLog(`${target.name} 的PE谱师使「崩所有人RPE」对其不产生效果。`, "event");
      } else {
        const dimension = randomItem(["config", "abstract", "concrete"]);
        const nextValue = Math.floor(target.scores[dimension] / 2);
        setScore(targetIndex, dimension, nextValue, { sourcePlayerIndex: playerIndex });
        appendLog(`${target.name} 触发「崩所有人RPE」：${DIMENSION_LABELS[dimension]}减半至${nextValue}。`, "event");
      }
    });
  } else if (event.id === "clock-link") {
    game.players.forEach(target => {
      target.extraTurnCredits++;
      if (target.extraTurnEligibleAfter == null) target.extraTurnEligibleAfter = game.turn.number;
    });
    appendLog(`${player.name} 触发「时钟链接！」：所有玩家的下一个回合获得额外回合。`, "event");
  } else if (event.id === "sun-tide") {
    game.turnDirection = -1;
    appendLog(`${player.name} 触发「凌日潮汐」：行动顺序逆转至1号玩家。`, "event");
  } else if (event.id === "tribunal") {
    const lowestPlayers = shuffle(game.players.map((candidate, index) => ({
      candidate,
      index,
      score: totalScore(candidate)
    }))).sort((a, b) => a.score - b.score).slice(0, 2);
    lowestPlayers.forEach(entry => gainReputation(entry.index, -8));
    appendLog(`${player.name} 触发「众裁“区”」：${lowestPlayers.map(entry => entry.candidate.name).join("、")}声望-8。`, "event");
  } else if (event.id === "computer-removed") {
    applyScoreChange(playerIndex, "innovation", 5, { sourcePlayerIndex: playerIndex });
    player.skipNextTurn = true;
    player.computerRemovedBonus = true;
    appendLog(`${player.name} 触发「电脑被没收了」：创新程度+5，下一回合被跳过，回合结束时爆肝程度+2。`, "event");
  } else if (event.id === "chart-missing") {
    const hasLowStamina = player.characters.some(instance => {
      const def = characterDefinition(instance.id);
      const stamina = characterStats(instance.id)?.stamina + (instance.staminaBonus || 0);
      return def && stamina <= 5;
    });
    if (!hasLowStamina) {
      appendLog(`${player.name} 触发「谱面找不到了」，但爆肝程度未≤5，无效果。`, "event");
    } else {
      const discarded = player.hand.splice(0);
      discarded.forEach(card => game.discard.push(card));
      player.handCount = player.hand.length;
      appendLog(`${player.name} 触发「谱面找不到了」：弃置所有手牌（共${discarded.length}张）。`, "event");
    }
  }

  triggerCanadaEventPassive();
  game.deck.push(card);
  shuffle(game.deck);
}

function resolvePendingEvent(memberId, payload = {}) {
  const pending = game.pendingEvent;
  if (!pending || pending.responderMemberId !== memberId) return fail("当前没有需要你处理的事件");
  const actor = game.players[pending.actorIndex];
  if (!actor) return fail("事件发起玩家不存在");

  if (pending.stage === "choose") {
    const isMaimai = pending.eventId === "maimai";
    let ownEntry = null;
    if (!isMaimai) {
      ownEntry = characterEntryByUid(payload.ownCharacterUid);
      if (!ownEntry || ownEntry.playerIndex !== pending.actorIndex) return fail("请选择自己的角色牌");
    }
    const targetPlayerIndex = game.players.findIndex(candidate =>
      candidate.memberId === payload.targetMemberId &&
      candidate.memberId !== actor.memberId
    );
    const target = game.players[targetPlayerIndex];
    if (!target) return fail("请选择另一位玩家");
    if (ownsCharacter(target, "cherry")) {
      const points = pending.eventId === "maimai" ? 3 : pending.eventId === "chunithm" ? 5 : 6;
      applyScoreChange(pending.actorIndex, "config", points, { sourcePlayerIndex: pending.actorIndex });
      if (pending.eventId !== "maimai") {
        applyScoreChange(pending.actorIndex, "concrete", points, { sourcePlayerIndex: pending.actorIndex });
      }
      appendLog(`${target.name} 的“樱桃喝酒人”免疫「${eventDefinition(pending.eventId).name}」，仅${actor.name}获得能力加成。`, "event");
      game.pendingEvent = null;
      return ok();
    }
    game.pendingEvent = {
      ...pending,
      stage: "response",
      responderMemberId: target.memberId,
      ownCharacterUid: ownEntry ? ownEntry.character.uid : null,
      targetPlayerIndex
    };
    appendLog(`${target.name} 需要响应「${eventDefinition(pending.eventId).name}」。`, "event");
    return ok();
  }

  if (pending.stage === "response") {
    const target = game.players[pending.targetPlayerIndex];
    if (!target || target.memberId !== memberId) return fail("目标玩家不存在");
    const mustAccept = pending.eventId === "maimai";
    const accepted = mustAccept || payload.decision === "accept";
    if (!accepted && payload.decision !== "refuse") return fail("请选择同意或拒绝");
    if (!accepted) {
      gainReputation(pending.actorIndex, -5);
      const points = pending.eventId === "chunithm" ? 5 : 6;
      applyScoreChange(pending.actorIndex, "config", points, { sourcePlayerIndex: pending.actorIndex });
      applyScoreChange(pending.actorIndex, "concrete", points, { sourcePlayerIndex: pending.actorIndex });
      appendLog(`${target.name} 拒绝「${eventDefinition(pending.eventId).name}」：${actor.name}声望-5，配置与具象动效+${points}。`, "event");
      game.pendingEvent = null;
      return ok();
    }
    const targetEntry = characterEntryByUid(payload.targetCharacterUid);
    if (!targetEntry || targetEntry.playerIndex !== pending.targetPlayerIndex) return fail("请选择自己的角色牌");
    const points = pending.eventId === "maimai" ? 3 : pending.eventId === "chunithm" ? 5 : 6;
    applyScoreChange(pending.actorIndex, "config", points, { sourcePlayerIndex: pending.actorIndex });
    applyScoreChange(pending.targetPlayerIndex, "config", points, { sourcePlayerIndex: pending.actorIndex });
    if (pending.eventId !== "maimai") {
      applyScoreChange(pending.actorIndex, "concrete", points, { sourcePlayerIndex: pending.actorIndex });
      applyScoreChange(pending.targetPlayerIndex, "concrete", points, { sourcePlayerIndex: pending.actorIndex });
    }
    targetEntry.character.disabledTurns = Math.max(targetEntry.character.disabledTurns, 1);
    appendLog(`${target.name} 完成「${eventDefinition(pending.eventId).name}」：双方${pending.eventId === "maimai" ? "配置" : "配置与具象动效"}+${points}。`, "event");
    game.pendingEvent = null;
    return ok();
  }

  return fail("事件状态无效");
}

function drawSkillFromPool(playerIndex) {
  const player = game.players[playerIndex];
  if (!player) return null;
  const worldTree = tryDrawWorldTree(playerIndex);
  if (worldTree) return worldTree;
  const definition = weightedSkillCard();
  const card = createCard("skill", definition.id);
  player.hand.push(card);
  player.handCount = player.hand.length;
  if (card.cardId === "deification") player.deificationPending = card.uid;
  return card;
}

// 世界树：每次摸牌时先判定，创新>15且爆肝>10时有15%概率替换本次摸牌
function tryDrawWorldTree(playerIndex) {
  const player = game.players[playerIndex];
  if (!player) return null;
  if ((player.scores.innovation || 0) > 15 && playerMaxStamina(player) > 10 && Math.random() < 0.15) {
    const card = createCard("skill", "world-tree");
    player.hand.push(card);
    player.handCount = player.hand.length;
    appendLog(`${player.name} 触发了「世界树」的召唤！`, "event");
    return card;
  }
  return null;
}

// 按稀有度加权抽取技能牌：白50% / 绿25% / 蓝15% / 紫7% / 橙2.9% / 彩0.1%
function weightedSkillCard() {
  const weighted = [];
  let totalWeight = 0;
  SKILL_CARDS.forEach(card => {
    if (card.special) return;
    const w = SKILL_RARITY[card.rarity]?.weight ?? 0;
    if (w > 0) { weighted.push({ card, w }); totalWeight += w; }
  });
  if (!weighted.length) return SKILL_CARDS[0];
  let roll = Math.random() * totalWeight;
  for (const entry of weighted) {
    roll -= entry.w;
    if (roll <= 0) return entry.card;
  }
  return weighted[weighted.length - 1].card;
}

function drawCard(playerIndex) {
  refillDeckIfNeeded();
  const player = game.players[playerIndex];
  if (!player) return { kind: "empty" };

  const worldTree = tryDrawWorldTree(playerIndex);
  if (worldTree) return { kind: "skill", name: "世界树" };

  if (ownsCharacter(player, "cherry")) {
    const skillIndex = game.deck.map(item => item.type).lastIndexOf("skill");
    if (skillIndex >= 0) {
      const card = game.deck.splice(skillIndex, 1)[0];
      player.hand.push(card);
      player.handCount = player.hand.length;
      if (card.cardId === "deification") player.deificationPending = card.uid;
      appendLog(`${player.name} 摸到1张技能牌。`);
      return { kind: "skill", name: skillDefinition(card.cardId)?.name || "技能牌" };
    }
    const card = drawSkillFromPool(playerIndex);
    appendLog(`${player.name} 摸到1张技能牌。`);
    return { kind: "skill", name: skillDefinition(card.cardId)?.name || "技能牌" };
  }

  const card = game.deck.pop();
  if (!card) {
    appendLog("牌堆和弃牌堆均为空，本次未摸到牌。", "event");
    return { kind: "empty" };
  }
  if (card.type === "event") {
    const event = eventDefinition(card.cardId);
    resolveEvent(playerIndex, card);
    return { kind: "event", name: event?.name || "事件牌" };
  }
  player.hand.push(card);
  player.handCount = player.hand.length;
  if (card.cardId === "deification") player.deificationPending = card.uid;
  const skill = skillDefinition(card.cardId);
  appendLog(`${player.name} 摸到1张技能牌。`);
  return { kind: "skill", name: skill.name };
}

function drawCards(playerIndex, count, skillOnly = false) {
  const results = [];
  for (let i = 0; i < count; i++) {
    if (skillOnly) {
      const card = drawSkillFromPool(playerIndex);
      results.push(card ? { kind: "skill", name: skillDefinition(card.cardId)?.name } : { kind: "empty" });
    } else {
      results.push(drawCard(playerIndex));
    }
  }
  // 非常规摸牌溢出处理：手牌超过上限时，强制打出超出部分（需选对象的牌直接弃置）
  const player = game.players[playerIndex];
  if (player && player.hand.length > (player.handLimit ?? 5)) {
    let guard = 0;
    while (player.hand.length > (player.handLimit ?? 5) && guard++ < 100) {
      const idx = Math.floor(Math.random() * player.hand.length);
      forcePlayCard(playerIndex, player.hand[idx].uid);
    }
    // 兜底：若仍超标，直接弃置超出部分
    while (player.hand.length > (player.handLimit ?? 5)) {
      const [removed] = player.hand.splice(0, 1);
      game.discard.push(removed);
    }
    player.handCount = player.hand.length;
    appendLog(`${player.name} 手牌超过上限，已强制打出/弃置超出部分。`, "event");
  }
  return results;
}

function dealInitialHands() {
  game.players.forEach((player, playerIndex) => {
    recomputeHandLimit(player);
    const count = Math.min(5, player.handLimit);
    drawCards(playerIndex, count, true);
    appendLog(`${player.name} 从技能卡池抽取${count}张技能牌（手牌上限 ${player.handLimit}）。`);
  });
}

function settleDystopia() {
  if (!game.dystopia) return;
  const owner = game.players[game.dystopia.ownerIndex];
  const queue = game.dystopiaQueue;
  let allOffset = queue.length > 0;
  queue.forEach(item => {
    if (!item.offset) {
      allOffset = false;
      applyScoreChange(item.playerIndex, item.dimension, -item.amount, {
        sourcePlayerIndex: game.dystopia.ownerIndex,
        skipDystopia: true,
        skipStarPending: true
      });
    }
  });
  if (allOffset && owner) {
    const card = createCard("skill", "utopia-overture");
    owner.hand.push(card);
    owner.handCount = owner.hand.length;
    appendLog(`${owner.name} 本轮所有减分均被抵消，获得一张【乌托邦序曲】。`, "event");
  }
  game.dystopia = null;
  game.dystopiaQueue = [];
}

function offsetDystopia(playerIndex, cardUid) {
  if (!game.dystopia || game.dystopia.ownerIndex !== playerIndex) return fail("你没有激活反乌托邦");
  const player = game.players[playerIndex];
  const idx = player.hand.findIndex(c => c.uid === cardUid);
  if (idx < 0) return fail("手牌不存在");
  const [discarded] = player.hand.splice(idx, 1);
  game.discard.push(discarded);
  player.handCount = player.hand.length;
  let target = null;
  for (let i = game.dystopiaQueue.length - 1; i >= 0; i--) {
    if (!game.dystopiaQueue[i].offset) { target = game.dystopiaQueue[i]; break; }
  }
  if (target) {
    target.offset = true;
    appendLog(`${player.name} 弃置一张手牌，抵消了${game.players[target.playerIndex].name}的${DIMENSION_LABELS[target.dimension]}减分。`, "effect");
  } else {
    appendLog(`${player.name} 弃置一张手牌，但当前无可抵消的减分。`, "event");
  }
  return ok();
}

function overtureReduce(playerIndex) {
  const player = game.players[playerIndex];
  if (!player.overtureActive) return fail("你没有序曲效果");
  if (player.overtureReduceUsed) return fail("本轮减分响应已用过");
  if (!game.lastReduction || game.lastReduction.turn !== game.turn.number) return fail("当前没有可响应的减分");
  const r = game.lastReduction;
  applyScoreChange(r.playerIndex, r.dimension, r.amount, { sourcePlayerIndex: playerIndex, skipStarPending: true });
  const topEntry = game.players.reduce((best, p) => {
    const sumBest = DIMENSIONS.reduce((s, d) => s + best.scores[d], 0);
    const sumP = DIMENSIONS.reduce((s, d) => s + p.scores[d], 0);
    return sumP > sumBest ? p : best;
  }, game.players[0]);
  const topIdx = game.players.indexOf(topEntry);
  applyScoreChange(topIdx, randomDimension(), -4, { sourcePlayerIndex: playerIndex, skipStarPending: true });
  player.overtureReduceUsed = true;
  game.lastReduction = null;
  appendLog(`${player.name} 发动「序曲·减分响应」：抵消减分，并使${topEntry.name}随机维度-4。`, "effect");
  return ok();
}

function overtureDiscard(playerIndex) {
  const player = game.players[playerIndex];
  if (!player.overtureActive) return fail("你没有序曲效果");
  if (player.overtureDiscardUsed) return fail("本轮弃牌响应已用过");
  if (!game.lastDiscard || game.lastDiscard.turn !== game.turn.number) return fail("当前没有可响应的弃牌");
  const d = game.lastDiscard;
  // 抵消弃牌：若牌还在弃牌堆末尾，则还回
  const top = game.discard[game.discard.length - 1];
  const victim = game.players[d.playerIndex];
  let restored = false;
  if (top && top.uid === d.cardUid && victim) {
    game.discard.pop();
    victim.hand.push(top);
    victim.handCount = victim.hand.length;
    restored = true;
  }
  const mostHand = game.players.reduce((best, p) => (p.hand.length > best.hand.length ? p : best), game.players[0]);
  for (let i = 0; i < 2; i++) {
    if (!mostHand.hand.length) break;
    const [dropped] = mostHand.hand.splice(mostHand.hand.length - 1, 1);
    game.discard.push(dropped);
  }
  mostHand.handCount = mostHand.hand.length;
  player.overtureDiscardUsed = true;
  game.lastDiscard = null;
  appendLog(`${player.name} 发动「序曲·弃牌响应」${restored ? "：抵消弃牌" : ""}，并使${mostHand.name}弃置2张牌。`, "effect");
  return ok();
}

function beginTurn() {
  const player = currentPlayer();
  if (!player) return;
  if (game.pecJamRestoreRound != null && game.round >= game.pecJamRestoreRound) {
    game.players.forEach(target => {
      target.disableCharacterTurns = 0;
      target.disableAllSkillTurns = 0;
      target.disableUntilOwnTurn = false;
      target.characters.forEach(character => {
        character.disabledTurns = 0;
        Object.keys(character.cooldowns).forEach(abilityId => {
          character.cooldowns[abilityId] = 0;
        });
      });
    });
    game.pecJamRestoreRound = null;
    appendLog("PecJam生效：所有角色牌的冷却和临时禁用状态已清除。", "event");
  }
  player.characters.forEach(character => {
    Object.keys(character.cooldowns).forEach(abilityId => {
      if (character.cooldowns[abilityId] > 0) character.cooldowns[abilityId]--;
    });
  });
  player.disableUntilOwnTurn = false;
  player.reviewActionUsed = false;
  player.counters.jinyeDraws = 0;
  player.counters.naoguiTriggered = false;
  player.counters.twoThreeEightLoss = 0;
  player.skillCardLimit = player.pendingSkillCardLimit;
  player.pendingSkillCardLimit = null;
  if (player.negativeImmuneTurns > 0) player.negativeImmuneTurns--;
  if (player.dccProtectionTurns > 0) player.dccProtectionTurns--;
  player.dimensionLocked = false;
  player.programEffect = false;
  if (player.silencedNextTurn) {
    player.silencedNextTurn = false;
    player.silenced = true;
    player.silencedAmplify = ownsCharacter(player, "ziyang") ? 6 : 3;
  } else {
    player.silenced = false;
    player.silencedAmplify = 0;
  }
  if (player.commissionLockAtRound != null && game.round >= player.commissionLockAtRound) {
    player.commissionLocked = true;
  }
  game.turn = {
    hasDrawn: false,
    skillCardsPlayed: 0,
    usedAbilityIds: [],
    botSkillCardUsed: false,
    botAbilityUsed: false,
    unsafeZonePlayedBy: [],
    brilliantReplayed: false,
    playableCards: player.handLimit ?? 5,
    number: game.turn.number + 1
  };
  // 不安全领域到期
  if (game.unsafeZone && game.turn.number >= game.unsafeZoneUntilTurn) {
    game.unsafeZone = false;
    game.unsafeZoneUntilTurn = null;
    appendLog("「不安全领域」已结束。", "event");
  }
  // 反乌托邦到期结算
  if (game.dystopia && game.turn.number >= game.dystopia.untilTurn) {
    settleDystopia();
  }
  // 序曲响应次数每轮重置
  if (game.round !== game.overtureResetRound) {
    game.overtureResetRound = game.round;
    game.players.forEach(p => {
      p.overtureReduceUsed = false;
      p.overtureDiscardUsed = false;
    });
  }
  // 世界树生机机制
  if (player.worldTreeActive && game.round > player.worldTreeStartRound) {
    let gain = ownsCharacter(player, "summercube") ? 3 : 1;
    player.vitality += gain;
    if (player.vitality >= 3) {
      player.vitality = 0;
      const maxChar = player.characters.reduce((best, c) => {
        const s = (characterStats(c.id)?.stamina || 0) + (c.staminaBonus || 0);
        const bs = best ? (characterStats(best.id)?.stamina || 0) + (best.staminaBonus || 0) : -1;
        return s > bs ? c : best;
      }, null);
      if (maxChar) maxChar.staminaBonus = (maxChar.staminaBonus || 0) + 5;
      const newCard = createCard("skill", "world-tree");
      player.hand.push(newCard);
      player.handCount = player.hand.length;
      appendLog(`${player.name} 的生机达到3点：爆肝程度+5，并获得一张【世界树】。`, "effect");
    }
  }
  appendLog(`轮到 ${player.name} 行动。`);
  player.lastActionAt = Date.now();
  // 神化论：抽到后下个自己回合开始时自动打出
  if (player.deificationPending) {
    const pendingCard = player.hand.find(c => c.uid === player.deificationPending && c.cardId === "deification");
    if (pendingCard) {
      executeSkillCard(game.currentPlayerIndex, pendingCard.uid, {});
    }
    player.deificationPending = null;
  }
  // 算数教室：未答对时下回合重复出题
  if (player.arithmeticPending) {
    player.arithmeticPending = false;
    openArithmeticQuestion(game.currentPlayerIndex);
  }
  if (player.extraDrawNextTurn > 0) {
    const count = player.extraDrawNextTurn;
    player.extraDrawNextTurn = 0;
    drawCards(game.currentPlayerIndex, count);
    appendLog(`${player.name} 额外摸${count}张牌。`, "effect");
  }
  if (isAIActor(player)) {
    if (!player.isBot) {
      appendLog(`${player.name} 由 AI 托管执行本轮操作。`, "event");
    }
    scheduleBotAction();
    return;
  }
  // You Suffer：本回合仅1秒，倒计时结束自动结束回合
  if (player.youSufferTurn) {
    player.youSufferTurn = false;
    appendLog(`${player.name} 受到「You Suffer」影响：本回合仅1秒。`, "event");
    setTimeout(() => {
      if (room.isHost && game && game.phase === GAME_PHASE.TURN && currentPlayer() === player) {
        hostDispatch(player.memberId, "END_TURN", {}, "", true);
      }
    }, 1000);
  }
  if (!player.isBot && player.connected === false) {
    appendLog(`${player.name} 处于断线状态，AI 将在 15 秒后接管操作。`, "event");
    setTimeout(() => {
      if (game && game.phase !== GAME_PHASE.SETTLEMENT && currentPlayer() === player && player.connected === false && !player.aiControlled) {
        appendLog(`${player.name} 断线未重连，AI 接管本轮操作。`, "event");
        scheduleBotAction();
      }
    }, 15000);
  }
}

function buyCharacter(playerIndex, characterId) {
  const player = game.players[playerIndex];
  const character = characterDefinition(characterId);
  if (!character) return fail("角色不存在");
  if (player.characters.some(item => item.id === characterId)) return fail("不能重复购置同一角色");
  const price = RARITY[character.rarity].price;
  if (player.funds < price) return fail("购置点数不足");
  player.funds -= price;
  const cooldowns = {};
  const uses = {};
  character.abilities.forEach(ability => {
    cooldowns[ability.id] = 0;
    uses[ability.id] = 0;
  });
  player.characters.push({
    uid: `c_${cryptoRandom(8)}`,
    id: character.id,
    cooldowns,
    uses,
    disabledTurns: 0,
    permanentlyDisabled: false,
    recruited: false
  });
  // 将角色的选曲品味加到玩家得分中
  player.scores.selection += characterStats(characterId).selection;
  recomputeHandLimit(player);
  appendLog(`${player.name} 购置了「${character.name}」（选曲品味 +${characterStats(characterId).selection}），剩余${player.funds}点。`, "effect");
  return ok();
}

function finishDraft(playerIndex) {
  const player = game.players[playerIndex];
  if (!player.characters.length) return fail("至少购置1名角色后才能完成购置");
  if (game.draftDone.includes(player.memberId)) return fail("你已完成购置");
  game.draftDone.push(player.memberId);
  appendLog(`${player.name} 完成角色购置。`);
  if (game.draftDone.length === game.players.length) {
    game.phase = GAME_PHASE.TURN;
    game.round = 1;
    game.currentPlayerIndex = 0;
    dealInitialHands();
    appendLog("购置阶段结束。第1轮开始，每位玩家只能发动1次角色技能，不摸牌且不能使用技能牌。", "event");
    beginTurn();
  } else {
    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    const next = game.players[game.currentPlayerIndex];
    if (next) next.lastActionAt = Date.now();
  }
  return ok();
}

function characterAbilityDefinition(characterId, abilityId) {
  return characterDefinition(characterId)?.abilities.find(ability => ability.id === abilityId);
}

function isAllSkillBlocked(player) {
  return player.disableAllSkillTurns > 0 || player.disableUntilOwnTurn;
}

function isNegativeSkillCard(definition) {
  return Boolean(definition && definition.category === "attack" && definition.id !== "kkp");
}

function canActivateCharacter(player, instance, ability) {
  if (player.silenced) return fail("静默状态不可发动角色技能");
  if (instance.permanentlyDisabled) return fail("该角色技能已永久失效");
  const useKey = `${instance.uid}:${ability.id}`;
  const repeatReady = globalModifierActive("repeat") && Boolean(instance.repeatAvailable?.[ability.id]);
  if (game.turn.usedAbilityIds.includes(useKey) && !repeatReady) return fail("该技能本回合已经发动过");
  const firstRound = game.round === 1;
  if (firstRound && player.firstRoundSkillUsed) return fail("第1轮只能发动1次角色技能");
  if (!firstRound && (player.disableCharacterTurns > 0 || isAllSkillBlocked(player) || instance.disabledTurns > 0)) {
    return fail("本回合角色技能被禁用");
  }
  if (instance.cooldowns[ability.id] > 0) return fail(`技能冷却剩余${instance.cooldowns[ability.id]}回合`);
  if (ability.maxUses && instance.uses[ability.id] >= ability.maxUses) return fail("该技能已达到发动次数上限");
  if (ability.id === "ftayo-main" && game.round > Math.floor(game.totalRounds * .7)) return fail("已超过总回合数70%");
  if (instance.id === "dun-stili") {
    if (ability.id === "dun-stili-rarity" && player.dunStiliToggle) return fail("本回合应使用另一个效果");
    if (ability.id === "dun-stili-peak" && !player.dunStiliToggle) return fail("本回合应使用另一个效果");
  }
  return ok();
}

function activateCharacter(playerIndex, characterId, abilityId, payload = {}) {
  const player = game.players[playerIndex];
  const instance = player.characters.find(character => character.id === characterId);
  const definition = characterDefinition(characterId);
  const ability = characterAbilityDefinition(characterId, abilityId);
  if (!instance || !definition || !ability) return fail("未拥有该角色技能");
  const allowed = canActivateCharacter(player, instance, ability);
  if (!allowed.ok) return allowed;
  if (ability.choice === "two-dimensions") {
    const choices = Array.isArray(payload.dimensions) ? [...new Set(payload.dimensions)] : [];
    if (choices.length !== 2 || choices.some(dim => !CHANGEABLE_DIMENSIONS.includes(dim))) return fail("请选择2个不同维度");
  }
  if (ability.choice === "motion-distribution") {
    const abstractPoints = Number(payload.abstractPoints);
    if (!Number.isInteger(abstractPoints) || abstractPoints < 0 || abstractPoints > 10) return fail("请分配10个动效点数");
  }
  if (ability.choice === "opponent" || ability.choice === "opponent-card") {
    const target = game.players.find(candidate => candidate.memberId === payload.targetMemberId);
    if (!target || target.memberId === player.memberId) return fail("请选择1名其他玩家");
  }
  if (ability.choice === "opponent-card") {
    if (!payload.targetCardUid) return fail("请选择一张要获得的卡牌");
  }
  if (ability.choice === "discard-cards") {
    const uids = Array.isArray(payload.discardUids) ? [...new Set(payload.discardUids)] : [];
    if (!uids.length || uids.length > 3) return fail("请选择1~3张要弃置的牌");
    if (uids.some(uid => !player.hand.some(c => c.uid === uid && c.type !== "star"))) return fail("只能弃置手中的技能牌");
  }
  if (ability.choice === "rarity") {
    const rarity = payload.rarity;
    if (!SKILL_RARITY[rarity]) return fail("请选择一个稀有度");
  }
  if (ability.choice === "own-peak-dimension") {
    if (payload.dimension && !CHANGEABLE_DIMENSIONS.includes(payload.dimension)) return fail("请选择一个有效维度");
  }

  if (game.round === 1) {
    const baseStats = characterStats(characterId);
    DIMENSIONS.forEach(dimension => {
      player.scores[dimension] = baseStats[dimension];
    });
    player.firstRoundSkillUsed = true;
    appendLog(`${player.name} 以「${definition.name}」确定谱面全部五维初始分数。`, "effect");
  }

  if (ability.id === "ftayo-main") {
    payload.dimensions.forEach(dimension => {
      const highest = Math.max(...game.players.map(target => target.scores[dimension]));
      setScore(playerIndex, dimension, highest, { sourcePlayerIndex: playerIndex });
    });
    appendLog(`${player.name} 发动Ftayo技能：2个维度提升至全场最高。`, "effect");
  } else if (ability.id === "summercube-main") {
    applyScoreChange(playerIndex, "config", -1, { sourcePlayerIndex: playerIndex });
    applyScoreChange(playerIndex, "concrete", 10, { sourcePlayerIndex: playerIndex });
    appendLog(`${player.name} 发动Summercube技能：配置-1，具象动效+10。`, "effect");
  } else if (ability.id === "sulfur-main") {
    const abstractPoints = Number(payload.abstractPoints);
    applyScoreChange(playerIndex, "abstract", abstractPoints, { sourcePlayerIndex: playerIndex });
    applyScoreChange(playerIndex, "concrete", 10 - abstractPoints, { sourcePlayerIndex: playerIndex });
    appendLog(`${player.name} 发动SulfurDXD技能：分配10点动效。`, "effect");
  } else if (ability.id === "jinye-main") {
    const amount = Math.random() < .2 ? -2 : 5;
    applyScoreChange(playerIndex, "abstract", amount, { sourcePlayerIndex: playerIndex });
    appendLog(`${player.name} 发动金叶技能：抽象动效${amount > 0 ? "+" : ""}${amount}。`, "effect");
  } else if (ability.id === "ruishi-main") {
    const highest = Math.max(...DIMENSIONS.map(dim => player.scores[dim]));
    setScore(playerIndex, "config", Math.max(player.scores.config, highest), { sourcePlayerIndex: playerIndex });
    setScore(playerIndex, "abstract", Math.max(player.scores.abstract, highest), { sourcePlayerIndex: playerIndex });
    if (ownsCharacter(player, "cherry")) {
      DIMENSIONS.forEach(dim => applyScoreChange(playerIndex, dim, 1, { sourcePlayerIndex: playerIndex }));
    }
    appendLog(`${player.name} 发动瑞矢级别大技能。`, "effect");
  } else if (ability.id === "cherry-main") {
    applyScoreChange(playerIndex, "config", 2, { sourcePlayerIndex: playerIndex });
    applyScoreChange(playerIndex, "abstract", 2, { sourcePlayerIndex: playerIndex });
    if (ownsCharacter(player, "ruishi")) {
      DIMENSIONS.forEach(dim => applyScoreChange(playerIndex, dim, 1, { sourcePlayerIndex: playerIndex }));
    }
    appendLog(`${player.name} 发动樱桃喝酒人技能。`, "effect");
  } else if (ability.id === "naogui-main") {
    applyScoreChange(playerIndex, "config", 2, { sourcePlayerIndex: playerIndex });
    appendLog(`${player.name} 发动恼鬼技能：配置水平+2。`, "effect");
  } else if (ability.id === "two-three-eight-main") {
    applyScoreChange(playerIndex, "abstract", 5, { sourcePlayerIndex: playerIndex });
    appendLog(`${player.name} 发动238技能：抽象动效+5。`, "effect");
  } else if (ability.id === "tokyo-main") {
    // 加拿大鹅 aura：场上存在其他玩家的加拿大鹅时，本玩家的东京爷配置水平提升量减半
    // 该减半不触发东京爷的免疫减少被动（applyScoreChange 不走负数分支即可）
    const halved = game.players.some((candidate, index) => index !== playerIndex && ownsCharacter(candidate, "canada-goose"));
    applyScoreChange(playerIndex, "config", halved ? 2 : 4, { sourcePlayerIndex: playerIndex });
    appendLog(`${player.name} 发动地道东京爷技能：配置水平+${halved ? 2 : 4}。`, "effect");
  } else if (ability.id === "furry-main") {
    if (Math.random() < .75) {
      drawCards(playerIndex, 1);
      appendLog(`${player.name} 发动福瑞王技能：额外抽1张牌。`, "effect");
    } else {
      DIMENSIONS.forEach(dim => applyScoreChange(playerIndex, dim, dim === "innovation" ? 3 : -1, { sourcePlayerIndex: playerIndex }));
      appendLog(`${player.name} 发动福瑞王技能并触发“创新”。`, "effect");
    }
  } else if (ability.id === "canada-wjc") {
    if (game.round === 1) {
      appendLog(`${player.name} 发动WJC：第1轮限制他人角色技能的效果无效。`, "effect");
    } else {
      game.players.forEach((target, targetIndex) => {
        if (targetIndex === playerIndex) return;
        target.characters.forEach(character => {
          if (character.id !== "canada-goose") character.disabledTurns = Math.max(character.disabledTurns, 1);
        });
      });
      appendLog(`${player.name} 发动WJC：其他玩家的非加拿大鹅角色卡下回合禁用。`, "effect");
    }
  } else if (ability.id === "canada-shift") {
    const targetIds = Array.isArray(payload.targetMemberIds) ? [...new Set(payload.targetMemberIds)].slice(0, 2) : [];
    targetIds.forEach(memberId => {
      const targetIndex = game.players.findIndex(candidate => candidate.memberId === memberId && candidate.memberId !== player.memberId);
      if (targetIndex >= 0) applyScoreChange(targetIndex, randomDimension(), -1, { sourcePlayerIndex: playerIndex });
    });
    applyScoreChange(playerIndex, randomDimension(), 2, { sourcePlayerIndex: playerIndex });
    appendLog(`${player.name} 发动加拿大鹅技能。`, "effect");
  } else if (ability.id === "disinfectant-main") {
    if (game.round === 1) {
      appendLog(`${player.name} 发动“魅惑”：第1轮限制他人角色技能的效果无效。`, "effect");
    } else {
      const cards = game.players.flatMap(target => target.characters).filter(character => !character.permanentlyDisabled);
      shuffle(cards);
      cards.slice(0, Math.max(0, game.players.length - 1)).forEach(character => {
        character.disabledTurns = Math.max(character.disabledTurns, 1);
      });
      appendLog(`${player.name} 发动“魅惑”。`, "effect");
    }
  } else if (ability.id === "ziwei-main") {
    if (Math.random() < .8) {
      const dimension = randomDimension();
      applyScoreChange(playerIndex, dimension, 3, { sourcePlayerIndex: playerIndex });
      appendLog(`${player.name} 发动子微中技能：${DIMENSION_LABELS[dimension]}+3。`, "effect");
    } else {
      appendLog(`${player.name} 发动子微中技能并触发“子微”，技能失败。`, "effect");
    }
  } else if (ability.id === "chi-mahu-main") {
    const targetIndex = game.players.findIndex(candidate => candidate.memberId === payload.targetMemberId);
    const target = game.players[targetIndex];
    const cost = player.handExchangeCost;
    const before = player.reputation;
    gainReputation(playerIndex, -cost);
    const actualCost = before - player.reputation;
    appendLog(`${player.name} 发动「吃马虎」技能，以 ${actualCost} 点声望为代价（下次代价翻倍为 ${cost * 2} 点）。`, "effect");
    handleNonPlayCardLoss(playerIndex, player.hand.length);
    handleNonPlayCardLoss(targetIndex, target.hand.length);
    const ownHand = player.hand;
    player.hand = target.hand;
    target.hand = ownHand;
    player.handCount = player.hand.length;
    target.handCount = target.hand.length;
    player.handExchangeCost *= 2;
    appendLog(`${player.name} 与${target.name}交换全部手牌（各 ${player.handCount}/${target.handCount} 张）。`, "effect");
  } else if (ability.id === "dagezi-main") {
    const lowest = Math.min(...DIMENSIONS.map(dim => player.scores[dim]));
    DIMENSIONS.forEach(dim => setScore(playerIndex, dim, lowest, { sourcePlayerIndex: playerIndex }));
    gainReputation(playerIndex, 1);
    appendLog(`${player.name} 发动大鸽子喵喵喵技能：选曲品味外的维度降至${lowest}，声望+1。`, "effect");
  } else if (ability.id === "hotwind-main") {
    gainReputation(playerIndex, -1);
    game.players.forEach((target, targetIndex) => {
      if (target.reviewTurns > 0) applyScoreChange(targetIndex, "abstract", -8, { sourcePlayerIndex: playerIndex });
    });
    appendLog(`${player.name} 发动热风小西八技能：评议玩家抽象动效-8。`, "effect");
  } else if (ability.id === "liuzhizhi-main") {
    const targetIndex = game.players.findIndex(candidate => candidate.memberId === payload.targetMemberId);
    if (targetIndex < 0) return fail("目标不存在");
    const targetPlayer = game.players[targetIndex];
    const whiteGreenCards = targetPlayer.hand.filter(c => {
      const def = skillDefinition(c.cardId);
      return def && (def.rarity === "white" || def.rarity === "green");
    });
    if (!whiteGreenCards.length) return fail("目标没有白色或绿色手牌");
    let selectedCard;
    if (payload.targetCardUid) {
      selectedCard = whiteGreenCards.find(c => c.uid === payload.targetCardUid);
      if (!selectedCard) return fail("选择的卡牌不存在或不符合条件");
    } else {
      selectedCard = randomItem(whiteGreenCards);
    }
    const cardIdx = targetPlayer.hand.findIndex(c => c.uid === selectedCard.uid);
    targetPlayer.hand.splice(cardIdx, 1);
    targetPlayer.handCount = targetPlayer.hand.length;
    player.hand.push(selectedCard);
    player.handCount = player.hand.length;
    const playResult = executeSkillCard(playerIndex, selectedCard.uid);
    if (!playResult.ok) {
      appendLog(`${player.name} 从${targetPlayer.name}获得「${skillDefinition(selectedCard.cardId).name}」但无法打出：${playResult.reason}`, "effect");
    } else {
      appendLog(`${player.name} 发动柳橙汁3743技能：从${targetPlayer.name}处获得并打出了「${skillDefinition(selectedCard.cardId).name}」。`, "effect");
    }
  } else if (ability.id === "jiaojian-main") {
    const uids = [...new Set(payload.discardUids || [])].slice(0, 3);
    let discarded = 0;
    uids.forEach(uid => {
      const idx = player.hand.findIndex(c => c.uid === uid && c.type !== "star");
      if (idx >= 0) {
        const [removed] = player.hand.splice(idx, 1);
        game.discard.push(removed);
        discarded++;
      }
    });
    drawCards(playerIndex, discarded);
    player.handCount = player.hand.length;
    appendLog(`${player.name} 发动「我是脚健我很脚健」：弃置${discarded}张技能牌，抽${discarded}张牌。`, "effect");
  } else if (ability.id === "ziyang-main") {
    const points = Math.floor(player.scores.innovation / 2);
    if (points <= 0) return fail("创新能力不足2点");
    applyScoreChange(playerIndex, "abstract", points, { sourcePlayerIndex: playerIndex });
    applyScoreChange(playerIndex, "concrete", points, { sourcePlayerIndex: playerIndex });
    appendLog(`${player.name} 发动「子阳」技能：每2点创新获得1点抽象、1点具象（具象提升翻倍）。`, "effect");
  } else if (ability.id === "dun-stili-rarity") {
    const rarity = payload.rarity;
    const discarded = player.hand.filter(c => c.type !== "star" && skillDefinition(c.cardId)?.rarity === rarity);
    discarded.forEach(c => {
      const i = player.hand.indexOf(c);
      if (i >= 0) player.hand.splice(i, 1);
      game.discard.push(c);
    });
    player.handCount = player.hand.length;
    const x = Math.min(discarded.length, 5);
    if (x > 0) {
      const dim = randomDimension();
      applyScoreChange(playerIndex, dim, x, { sourcePlayerIndex: playerIndex });
      appendLog(`${player.name} 发动「钝斯提李」效果1：弃置${discarded.length}张${rarity}牌，${DIMENSION_LABELS[dim]}+${x}。`, "effect");
    } else {
      appendLog(`${player.name} 发动「钝斯提李」效果1：没有可弃置的${rarity}牌。`, "effect");
    }
    if (player.hand.length === 0) {
      drawCards(playerIndex, 1);
      appendLog(`${player.name} 弃置后手牌为空，摸1张牌。`, "effect");
    }
    player.dunStiliToggle = true;
  } else if (ability.id === "dun-stili-peak") {
    const dim = payload.dimension || CHANGEABLE_DIMENSIONS.reduce((best, d) => player.scores[d] >= player.scores[best] ? d : best, "config");
    applyScoreChange(playerIndex, dim, -3, { sourcePlayerIndex: playerIndex });
    drawCards(playerIndex, 2);
    player.handCount = player.hand.length;
    appendLog(`${player.name} 发动「钝斯提李」效果2：${DIMENSION_LABELS[dim]}-3，摸2张牌。`, "effect");
    player.dunStiliToggle = false;
  }

  const actualCooldown = ability.id === "two-three-eight-main" && ownsCharacter(player, "ftayo") ? 2 : ability.cooldown;
  const wasFirstActivation = instance.uses[ability.id] === 0;
  instance.cooldowns[ability.id] = actualCooldown;
  instance.uses[ability.id]++;
  game.turn.usedAbilityIds.push(`${instance.uid}:${ability.id}`);
  if (globalModifierActive("repeat")) {
    if (wasFirstActivation) {
      instance.repeatAvailable = instance.repeatAvailable || {};
      instance.repeatAvailable[ability.id] = true;
      instance.cooldowns[ability.id] = 0;
      appendLog(`${player.name} 触发「复读」：${definition.name}的技能可立即再发动一次。`, "effect");
    } else if (instance.repeatAvailable?.[ability.id]) {
      instance.repeatAvailable[ability.id] = false;
    }
  }
  return ok();
}

function consumePlayedSkillCard(playerIndex, cardUid) {
  const player = game.players[playerIndex];
  const idx = player.hand.findIndex(c => c.uid === cardUid);
  if (idx < 0) return false;
  const [card] = player.hand.splice(idx, 1);
  game.discard.push(card);
  player.handCount = player.hand.length;
  if (!game.forcePlay) game.turn.skillCardsPlayed++;
  return true;
}

function executeSkillCard(playerIndex, cardUid, payload = {}) {
  const player = game.players[playerIndex];
  const cardIndex = player.hand.findIndex(card => card.uid === cardUid);
  if (cardIndex < 0) return fail("手牌不存在");
  const card = player.hand[cardIndex];
  const definition = skillDefinition(card.cardId);
  const forcePlay = game.forcePlay === true;
  const ownTurn = game.currentPlayerIndex === playerIndex || forcePlay;
  if (!definition) return fail("卡牌数据不存在");
  if (!ownTurn) return fail("该牌只能在自己的回合打出");
  if (game.round === 1) return fail("第1轮不能使用技能牌");
  if (isAllSkillBlocked(player) && !forcePlay) return fail("本回合不能发动技能");
  if (player.silenced && game.turn.skillCardsPlayed >= 1 && !forcePlay) return fail("静默状态仅能打出一张手牌");
  if (player.skillCardLimit != null && game.turn.skillCardsPlayed >= player.skillCardLimit && !forcePlay) {
    return fail(`本回合最多打出${player.skillCardLimit}张技能牌`);
  }
  if (game.turn.playableCards != null && game.turn.skillCardsPlayed >= game.turn.playableCards && !forcePlay) {
    return fail("本回合可打出的牌数已达上限");
  }

  let target = null;
  let targetIdx = -1;
  const targetMode = definition.targetMode;
  if (targetMode === TARGET_MODE.PLAYER || targetMode === TARGET_MODE.PLAYER_AND_DIMENSION) {
    target = game.players.find(candidate => candidate.memberId === payload.targetMemberId);
    if (!target) return fail("目标不存在");
    if (target.memberId === player.memberId) return fail("必须选择其他玩家");
    targetIdx = game.players.findIndex(candidate => candidate.memberId === target.memberId);
    if (targetMode === TARGET_MODE.PLAYER_AND_DIMENSION) {
      if (!payload.dimension || !CHANGEABLE_DIMENSIONS.includes(payload.dimension)) return fail("请选择一个属性");
    }
  } else if (!targetMode && definition.target === "opponent") {
    target = game.players.find(candidate => candidate.memberId === payload.targetMemberId);
    if (!target) return fail("目标不存在");
    if (target.memberId === player.memberId) return fail("必须选择其他玩家");
    targetIdx = game.players.findIndex(candidate => candidate.memberId === target.memberId);
  }

  if (target) {
    if (target.negativeImmuneTurns > 0 && isNegativeSkillCard(definition)) {
      return fail("对方已关闭评论区，无法被负面技能影响");
    }
    if (target.dccProtectionTurns > 0 && player.reputation <= target.reputation) {
      return fail("对方声望需要低于你");
    }
  }

  const brilliantSnapshot = (card.enchant === "brilliant" && !game.turn.brilliantReplayed)
    ? game.players.map(p => ({ ...p.scores }))
    : null;

  if (definition.id === "review") {
    player.reviewTurns = Math.max(player.reviewTurns, 3);
  } else if (definition.id === "commission") {
    const average = game.players.reduce((sum, candidate) => sum + candidate.scores.selection, 0) / game.players.length;
    setScore(playerIndex, "selection", average, {
      sourcePlayerIndex: playerIndex,
      allowSelectionChange: true,
      skipCrossing: true
    });
    drawCards(playerIndex, 1, true);
    const remainingRounds = game.totalRounds - game.round + 1;
    player.commissionLockAtRound = game.round + Math.floor(remainingRounds * .7);
    if (player.commissionLockAtRound <= game.round) player.commissionLocked = true;
  } else if (definition.id === "drink") {
    target.disableCharacterTurns = Math.max(target.disableCharacterTurns, 1);
    appendLog(`${target.name} 的 zpq 崩溃，下一回合角色技能禁用。`, "effect");
  } else if (definition.id === "fge") {
    if (player.storyboard) return fail("F鸽每名玩家仅能触发一次");
    player.storyboard = true;
    player.storyboardBonus = Math.max(player.storyboardBonus, 5 * skillCardPointMultiplier(player));
  } else if (definition.id === "study") {
    const dim = randomDimension(true);
    applyScoreChange(playerIndex, dim, 3 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, allowSelectionChange: true, fromSkillCard: true });
    appendLog(`${player.name} 打出「学习」：${DIMENSION_LABELS[dim]}+3。`, "effect");
  } else if (definition.id === "effort") {
    const ownChar = player.characters.find(c => c.uid === payload.characterUid);
    if (!ownChar) return fail("请选择自己的一名谱师");
    const dim = payload.dimension && CHANGEABLE_DIMENSIONS.includes(payload.dimension) ? payload.dimension : null;
    if (!dim) return fail("请选择一项属性");
    const def = characterDefinition(ownChar.id);
    const amount = characterStats(ownChar.id)?.[dim] || 0;
    applyScoreChange(playerIndex, dim, amount, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    appendLog(`${player.name} 打出「发力」：将${def.name}的${DIMENSION_LABELS[dim]}${amount}点加到自身。`, "effect");
  } else if (definition.id === "consult") {
    let count = 0;
    DIMENSIONS.forEach(dim => {
      if (player.scores[dim] < target.scores[dim]) {
        applyScoreChange(playerIndex, dim, 2 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, allowSelectionChange: true, fromSkillCard: true });
        count++;
      }
    });
    appendLog(`${player.name} 打出「请教」：对比${target.name}后有${count}个维度+2。`, "effect");
  } else if (definition.id === "only-this") {
    const dim = DIMENSIONS.reduce((best, d) => player.scores[d] > player.scores[best] ? d : best, "config");
    applyScoreChange(playerIndex, dim, 3 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, allowSelectionChange: true, fromSkillCard: true });
    appendLog(`${player.name} 打出「只会这个」：${DIMENSION_LABELS[dim]}+3。`, "effect");
  } else if (definition.id === "burn-out") {
    const mult = skillCardPointMultiplier(player);
    CHANGEABLE_DIMENSIONS.forEach(dim => applyScoreChange(playerIndex, dim, mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true }));
    if (player.hand.length === 1) { // 仅本牌，无其他手牌
      CHANGEABLE_DIMENSIONS.forEach(dim => applyScoreChange(playerIndex, dim, mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true }));
      appendLog(`${player.name} 没有其他手牌，「燃尽了」额外发动1次。`, "effect");
    }
  } else if (definition.id === "x-xxx") {
    applyScoreChange(playerIndex, "selection", 8 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, allowSelectionChange: true, fromSkillCard: true });
  } else if (definition.id === "latecomer") {
    const myScore = totalScore(player);
    const higherCount = game.players.filter(p => totalScore(p) > myScore).length;
    CHANGEABLE_DIMENSIONS.forEach(dim => applyScoreChange(playerIndex, dim, higherCount * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true }));
    appendLog(`${player.name} 打出「后起之秀」：差最高分${higherCount}名次，所有维度+${higherCount}。`, "effect");
  } else if (definition.id === "rizline") {
    applyScoreChange(playerIndex, "concrete", 10 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    if (Math.random() < 0.2) {
      applyScoreChange(playerIndex, "abstract", 5 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
      appendLog(`${player.name} 打出「Rizline？！」：具象+10，抽象+5。`, "effect");
    } else {
      appendLog(`${player.name} 打出「Rizline？！」：具象+10。`, "effect");
    }
  } else if (definition.id === "bilibili") {
    if (Math.random() >= 0.3) {
      const mult = skillCardPointMultiplier(player);
      applyScoreChange(playerIndex, "config", 2 * mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
      applyScoreChange(playerIndex, "concrete", 2 * mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    } else {
      appendLog(`${player.name} 打出「刷刷B站」：什么都没干。`, "effect");
    }
  } else if (definition.id === "tang-selection") {
    applyScoreChange(playerIndex, "selection", -2, { sourcePlayerIndex: playerIndex, allowSelectionChange: true, fromSkillCard: true });
    const rep = 1 + Math.floor(Math.random() * 5);
    gainReputation(playerIndex, rep);
    appendLog(`${player.name} 打出「唐氏选曲」：选曲-2，声望+${rep}。`, "effect");
  } else if (definition.id === "divergent") {
    const mult = skillCardPointMultiplier(player);
    applyScoreChange(playerIndex, "innovation", 8 * mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    applyScoreChange(playerIndex, "concrete", -3, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    if (player.scores.abstract > player.scores.concrete) {
      applyScoreChange(playerIndex, "abstract", 3 * mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    }
  } else if (definition.id === "bumper-cars") {
    setScore(playerIndex, "selection", target.scores.selection, { sourcePlayerIndex: playerIndex, allowSelectionChange: true });
    CHANGEABLE_DIMENSIONS.forEach(dim => applyScoreChange(playerIndex, dim, -1, { sourcePlayerIndex: playerIndex, fromSkillCard: true }));
    appendLog(`${player.name} 打出「别样的碰碰车大战」：选曲品味变为与${target.name}相同，其他维度-1。`, "effect");
  } else if (definition.id === "co-chart") {
    let chosen = null;
    let chosenOwnerName = "";
    for (const p of game.players) {
      const c = p.characters.find(ch => ch.uid === payload.characterUid);
      if (c) { chosen = c; chosenOwnerName = p.name; break; }
    }
    if (!chosen) return fail("请选择要参考的角色");
    const chosenDef = characterDefinition(chosen.id);
    const chosenStats = characterStats(chosen.id);
    const dim = CHANGEABLE_DIMENSIONS.reduce((best, d) => chosenStats[d] > chosenStats[best] ? d : best, "config");
    applyScoreChange(playerIndex, dim, 5 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    appendLog(`${player.name} 打出「写合作谱」：参考${chosenOwnerName}的${chosenDef.name}（${DIMENSION_LABELS[dim]}）+5。`, "effect");
  } else if (definition.id === "observe") {
    const mult = skillCardPointMultiplier(player);
    CHANGEABLE_DIMENSIONS.forEach(dim => applyScoreChange(playerIndex, dim, mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true }));
  } else if (definition.id === "start-chart") {
    const mult = skillCardPointMultiplier(player);
    CHANGEABLE_DIMENSIONS.forEach(dim => applyScoreChange(playerIndex, dim, mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true }));
  } else if (definition.id === "city-hero") {
    const mult = skillCardPointMultiplier(player);
    game.players.forEach((p, i) => {
      if (i !== playerIndex) CHANGEABLE_DIMENSIONS.forEach(dim => applyScoreChange(i, dim, mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true }));
    });
    gainReputation(playerIndex, 3);
  } else if (definition.id === "jinye-mentor") {
    const mult = skillCardPointMultiplier(player);
    applyScoreChange(playerIndex, "concrete", mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    applyScoreChange(playerIndex, "abstract", mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    if (ownsCharacter(player, "jinye")) applyScoreChange(playerIndex, "innovation", 2 * mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
  } else if (definition.id === "finish-chart") {
    const gain = Math.floor(player.scores.abstract / 3);
    applyScoreChange(playerIndex, "config", gain, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    appendLog(`${player.name} 打出「写完了」：抽象动效每3点换算1点配置，配置+${gain}。`, "effect");
  } else if (definition.id === "concise") {
    applyScoreChange(playerIndex, "concrete", -3, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    applyScoreChange(playerIndex, "config", 4 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    appendLog(`${player.name} 打出「简洁逼」：具象动效-3，配置+4。`, "effect");
  } else if (definition.id === "learn-from") {
    applyScoreChange(playerIndex, "innovation", 4 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
  } else if (definition.id === "watch-toilet") {
    const hasRecruited = game.players.some(p => p.characters.some(c => c.recruited));
    gainReputation(playerIndex, hasRecruited ? 3 : -3);
    appendLog(`${player.name} 打出「我要看城尾鱼上厕所」：场上${hasRecruited ? "有" : "无"}被招安谱师，声望${hasRecruited ? "+3" : "-3"}。`, "effect");
  } else if (definition.id === "image") {
    gainReputation(playerIndex, 2);
  } else if (definition.id === "record") {
    applyScoreChange(playerIndex, "selection", 7 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, allowSelectionChange: true, fromSkillCard: true });
  } else if (definition.id === "unthread") {
    setScore(playerIndex, "concrete", player.scores.abstract, { sourcePlayerIndex: playerIndex });
    appendLog(`${player.name} 打出「我拆线」：具象动效水平调整至与抽象动效水平一致。`, "effect");
  } else if (definition.id === "double-fall") {
    const mult = skillCardPointMultiplier(player);
    applyScoreChange(playerIndex, "config", 4 * mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    if (player.scores.config > 20) applyScoreChange(playerIndex, "config", 4 * mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
  } else if (definition.id === "forced-chart") {
    applyScoreChange(playerIndex, randomDimension(), -1, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    drawCards(playerIndex, 2);
  } else if (definition.id === "sv") {
    gainReputation(playerIndex, 1);
    const avg = DIMENSIONS.reduce((sum, d) => sum + player.scores[d], 0) / DIMENSIONS.length;
    const mult = skillCardPointMultiplier(player);
    const direction = player.scores.config > avg ? 5 : -5;
    applyScoreChange(playerIndex, "config", direction * mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    applyScoreChange(playerIndex, "abstract", direction * mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
  } else if (definition.id === "seniority") {
    const sum = player.scores.config + player.scores.concrete + player.scores.abstract + player.scores.innovation;
    const remainder = sum % 10;
    if (remainder > 0) gainReputation(playerIndex, remainder);
    appendLog(`${player.name} 打出「老资历我给您桂霞了」：声望+${remainder}。`, "effect");
  } else if (definition.id === "attention") {
    if (player.reputation <= 40) return fail("声望需大于40才可打出");
    const extra = Math.floor((player.reputation - 40) / 5);
    applyScoreChange(playerIndex, "innovation", (3 + extra) * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    appendLog(`${player.name} 打出「全体目光向我看齐」：创新+${3 + extra}。`, "effect");
  } else if (definition.id === "god-chart-attack") {
    const dim = randomDimension(true);
    const amount = -8 + Math.floor(Math.random() * 11);
    applyScoreChange(targetIdx, dim, amount, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    appendLog(`${player.name} 对${target.name}打出「神谱。」：${DIMENSION_LABELS[dim]}${amount >= 0 ? "+" : ""}${amount}。`, "effect");
  } else if (definition.id === "report") {
    if (Math.random() < 0.8) {
      target.characters.forEach(c => { c.disabledTurns = Math.max(c.disabledTurns, 1); });
      gainReputation(targetIdx, -10);
      appendLog(`${player.name} 对${target.name}打出「网报」：所有角色牌1回合禁用技能，对方声望-10。`, "effect");
    } else {
      gainReputation(playerIndex, -20);
      const available = player.characters.filter(c => !c.permanentlyDisabled);
      if (available.length) {
        randomItem(available).permanentlyDisabled = true;
        appendLog(`${player.name} 打出「网报」被发现：随机1个角色牌永久失效，自己声望-20。`, "effect");
      } else {
        appendLog(`${player.name} 打出「网报」被发现：没有可失效的角色，自己声望-20。`, "effect");
      }
    }
  } else if (definition.id === "no-time") {
    if (game.totalRounds - game.round >= 4) return fail("剩余轮数<4时方可打出");
    applyScoreChange(targetIdx, "config", -5 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    applyScoreChange(targetIdx, "concrete", -5 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
  } else if (definition.id === "amp") {
    const hasSpecial = target.characters.some(c => ["ftayo", "jinye", "ruishi"].includes(c.id));
    const hasZiwei = target.characters.some(c => c.id === "ziwei");
    if (hasZiwei) {
      appendLog(`${player.name} 对${target.name}打出「&.」：但对方有子微中，声望不受影响。`, "effect");
    } else {
      const amount = hasSpecial ? -3 : -2;
      gainReputation(targetIdx, amount);
      appendLog(`${player.name} 对${target.name}打出「&.」：声望${amount}。`, "effect");
    }
  } else if (definition.id === "bpm-bomb") {
    const avg = game.players.reduce((sum, p) => sum + p.scores.config, 0) / game.players.length;
    setScore(targetIdx, "config", avg, { sourcePlayerIndex: playerIndex });
    appendLog(`${player.name} 对${target.name}打出「BPM轰炸」：配置水平调整为平均值${avg.toFixed(1)}。`, "effect");
  } else if (definition.id === "random-chart") {
    const snapshot = { ...target.scores };
    DIMENSIONS.forEach(dim => {
      const otherDims = DIMENSIONS.filter(d => d !== dim);
      const sourceDim = randomItem(otherDims);
      setScore(targetIdx, dim, snapshot[sourceDim], { sourcePlayerIndex: playerIndex, allowSelectionChange: dim !== "selection" });
    });
    appendLog(`${player.name} 对${target.name}打出「随机数写谱」：先记录原数值再每维度独立随机映射。`, "effect");
  } else if (definition.id === "ibeam") {
    gainReputation(playerIndex, -3);
    applyScoreChange(targetIdx, "config", -12 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
  } else if (definition.id === "private-sample") {
    applyScoreChange(playerIndex, "selection", -3, { sourcePlayerIndex: playerIndex, allowSelectionChange: true, fromSkillCard: true });
    const mult = skillCardPointMultiplier(player);
    game.players.forEach((p, i) => {
      if (i !== playerIndex) applyScoreChange(i, "innovation", -3 * mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    });
  } else if (definition.id === "devil-arrival") {
    const mult = skillCardPointMultiplier(player);
    game.players.forEach((p, i) => {
      if (i !== playerIndex) CHANGEABLE_DIMENSIONS.forEach(dim => applyScoreChange(i, dim, -3 * mult, { sourcePlayerIndex: playerIndex, fromSkillCard: true }));
    });
    gainReputation(playerIndex, -1);
  } else if (definition.id === "storm") {
    const n = player.hand.length; // 包含打出的这张牌
    for (let i = 0; i < n; i++) {
      applyScoreChange(targetIdx, randomDimension(true), -1, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    }
    appendLog(`${player.name} 对${target.name}打出「暴风雨」：随机维度-1，共触发${n}次。`, "effect");
  } else if (definition.id === "burst") {
    if (target.reputation < player.reputation + 8) return fail("目标声望至少高出你8");
    gainReputation(targetIdx, -4);
    applyScoreChange(playerIndex, "innovation", 4 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
  } else if (definition.id === "tower-curse") {
    const ownChar = player.characters.find(c => c.uid === payload.ownCharacterUid);
    if (!ownChar) return fail("请选择自己的1张角色卡");
    const targetUids = Array.isArray(payload.targetCharacterUids) ? payload.targetCharacterUids : [];
    if (targetUids.length < 2 || targetUids.length > 3) return fail("需选择2~3张其他玩家角色卡");
    const targetChars = [];
    const seen = new Set();
    for (const uid of targetUids) {
      if (seen.has(uid)) return fail("不能重复选择角色");
      seen.add(uid);
      let found = null;
      for (let i = 0; i < game.players.length; i++) {
        if (i === playerIndex) continue;
        const c = game.players[i].characters.find(ch => ch.uid === uid);
        if (c) { found = c; break; }
      }
      if (!found) return fail("目标角色不存在或不属于其他玩家");
      targetChars.push(found);
    }
    ownChar.disabledTurns = Math.max(ownChar.disabledTurns, 1);
    targetChars.forEach(c => { c.disabledTurns = Math.max(c.disabledTurns, 1); });
    appendLog(`${player.name} 打出「塔之诅咒」：禁用自身1张+其他玩家${targetChars.length}张角色卡技能。`, "effect");
  } else if (definition.id === "one-unchanged") {
    const target_char = player.characters.find(c => c.uid === payload.characterUid && !c.permanentlyDisabled);
    if (!target_char) return fail("请选择要恢复的角色");
    target_char.disabledTurns = 0;
    Object.keys(target_char.cooldowns || {}).forEach(k => target_char.cooldowns[k] = 0);
    appendLog(`${player.name} 打出「一成不变」：${characterDefinition(target_char.id).name}技能恢复可用。`, "effect");
  } else if (definition.id === "refuse-chart") {
    const target_char = player.characters.find(c => c.uid === payload.characterUid && !c.permanentlyDisabled && c.disabledTurns === 0);
    if (!target_char) return fail("请选择一名技能可用的角色");
    const def = characterDefinition(target_char.id);
    def.abilities.forEach(a => { target_char.cooldowns[a.id] = a.cooldown; });
    drawCards(playerIndex, 2);
    appendLog(`${player.name} 打出「我就不写谱」：${def.name}技能重置为不可用，抽2张牌。`, "effect");
  } else if (definition.id === "tune-event") {
    const dim = randomDimension();
    game.players.forEach((_, i) => setScore(i, dim, 24, { sourcePlayerIndex: playerIndex }));
    appendLog(`${player.name} 打出「调所有人事件」：所有人的${DIMENSION_LABELS[dim]}变为24。`, "effect");
  } else if (definition.id === "chaos") {
    drawCards(playerIndex, 3);
    appendLog(`${player.name} 打出「混沌」：从牌堆顶抽3张牌。`, "effect");
  } else if (definition.id === "acrobatics") {
    const discardUid = payload.discardUid;
    let discardedName = "";
    if (discardUid) {
      const toRemove = player.hand.find(c => c.uid === discardUid);
      if (!toRemove) return fail("要弃置的牌不存在");
      const removeIdx = player.hand.indexOf(toRemove);
      player.hand.splice(removeIdx, 1);
      game.discard.push(toRemove);
      discardedName = skillDefinition(toRemove.cardId)?.name || "牌";
    }
    drawCards(playerIndex, 3);
    player.handCount = player.hand.length;
    appendLog(`${player.name} 打出「杂技」：${discardedName ? `弃置「${discardedName}」并` : ""}抽3张牌。`, "effect");
  } else if (definition.id === "remap") {
    const handSize = player.hand.length;
    player.hand.forEach(c => game.discard.push(c));
    player.hand = [];
    drawCards(playerIndex, handSize + 1);
    player.handCount = player.hand.length;
    game.turn.skillCardsPlayed++;
    appendLog(`${player.name} 打出「Remap」：弃置${handSize}张，抽${handSize + 1}张。`, "effect");
  } else if (definition.id === "hasty-draft") {
    applyScoreChange(playerIndex, "config", -3, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    applyScoreChange(playerIndex, "abstract", -3, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    applyScoreChange(playerIndex, "concrete", -3, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    drawCards(playerIndex, 5);
    appendLog(`${player.name} 打出「潦草急就」：配置/抽象/具象各-3，抽5张牌。`, "effect");
  } else if (definition.id === "beibei") {
    applyScoreChange(playerIndex, "innovation", 8 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    if (game.turn.lastSkillCardId === "x-xxx") {
      player.programEffect = true;
      appendLog(`${player.name} 打出「贝贝」：创新程度+8，并触发节目效果（下一回合开始前分数不会被减少）。`, "effect");
    } else {
      appendLog(`${player.name} 打出「贝贝」：创新程度+8。`, "effect");
    }
    game.turn.hasDrawn = true;
    player.beibeiSkipTurn = true;
  } else if (definition.id === "dcc") {
    gainReputation(playerIndex, 1);
    player.dccProtectionTurns = 3;
    appendLog(`${player.name} 打出「我提交了二十张DCC」：声望+1，3轮内他人需声望更高才能对你用牌。`, "effect");
  } else if (definition.id === "kkp") {
    applyScoreChange(playerIndex, "config", 4 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    applyScoreChange(targetIdx, "config", 2, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    target.skipNextTurn = true;
    appendLog(`${player.name} 打出「kkp」：自身配置+4，${target.name}配置+2并跳过下一回合。`, "effect");
  } else if (definition.id === "comment-off") {
    gainReputation(playerIndex, -5);
    player.negativeImmuneTurns = 3;
    player.dimensionLocked = true;
    appendLog(`${player.name} 打出「已关闭评论区」：声望-5，3轮内免疫负面技能，维度锁定至下一回合。`, "effect");
  } else if (definition.id === "star-hit") {
    const idx = player.hand.findIndex(c => c.uid === cardUid);
    const rightCards = idx >= 0 ? player.hand.slice(idx + 1) : [];
    let concreteBonus = 0, configBonus = 0, orangeCount = 0;
    rightCards.forEach(c => {
      const r = skillDefinition(c.cardId)?.rarity;
      if (r === "orange") { concreteBonus += 8; orangeCount++; }
      else if (r === "purple" || r === "blue") concreteBonus += 8;
      else if (r === "green" || r === "white") configBonus += 5;
    });
    const hasSpecial = ["ftayo", "two-three-eight", "naogui", "ziyang"].some(id => ownsCharacter(player, id));
    if (hasSpecial) {
      if (concreteBonus > 0) concreteBonus += 4;
      if (configBonus > 0) configBonus += 4;
    }
    // 将撞星右方的所有手牌替换成【星】
    const starCards = rightCards.map(() => createStarCard());
    player.hand.splice(idx + 1, rightCards.length, ...starCards);
    // 每包含一张橙色，额外摸一张【撞星】
    for (let i = 0; i < orangeCount; i++) {
      player.hand.push(createCard("skill", "star-hit"));
    }
    player.handCount = player.hand.length;
    if (concreteBonus > 0) applyScoreChange(playerIndex, "concrete", concreteBonus, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    if (configBonus > 0) applyScoreChange(playerIndex, "config", configBonus, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    appendLog(`${player.name} 打出「撞星」：右方${rightCards.length}张牌替换成【星】，具象+${concreteBonus}、配置+${configBonus}${orangeCount ? `，额外摸${orangeCount}张撞星` : ""}。`, "effect");
  } else if (definition.id === "limen") {
    applyScoreChange(playerIndex, "abstract", 6 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    applyScoreChange(playerIndex, "concrete", 6 * skillCardPointMultiplier(player), { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    player.silencedNextTurn = true;
    appendLog(`${player.name} 打出「里门」：抽象+6、具象+6，下回合进入静默状态。`, "effect");
  } else if (definition.id === "unsafe-zone") {
    if (game.turn.unsafeZonePlayedBy.includes(player.memberId)) return fail("本回合已打出过「不安全领域」");
    game.turn.unsafeZonePlayedBy.push(player.memberId);
    applyScoreChange(playerIndex, "abstract", 3, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    applyScoreChange(playerIndex, "config", 2, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    game.unsafeZone = true;
    game.unsafeZoneUntilTurn = game.turn.number + game.players.length;
    appendLog(`${player.name} 打出「不安全领域」：抽象+3、配置+2，全场进入不安全领域。`, "effect");
  } else if (definition.id === "deification") {
    player.hand.forEach(card => {
      if (card.uid === cardUid || card.type !== "skill") return;
      const def = skillDefinition(card.cardId);
      if (!def) return;
      if (def.category === "skill") card.enchant = "agile";
      else if (def.category === "growth") card.enchant = "brilliant";
      else if (def.category === "attack") card.enchant = "miracle";
    });
    player.skillCardLimit = 3;
    appendLog(`${player.name} 打出「神化论」：手牌已附魔，本回合最多主动打出3张牌。`, "effect");
  } else if (definition.id === "dystopia") {
    applyScoreChange(playerIndex, "config", 8, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    game.dystopia = { ownerIndex: playerIndex, untilTurn: game.turn.number + game.players.length };
    game.dystopiaQueue = [];
    appendLog(`${player.name} 打出「反乌托邦」：配置+8，进入待抵消状态。`, "effect");
  } else if (definition.id === "utopia-overture") {
    applyScoreChange(playerIndex, "abstract", 3, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    player.overtureActive = true;
    appendLog(`${player.name} 打出「乌托邦序曲」：抽象+3，获得永久【序曲】效果。`, "effect");
  } else if (definition.id === "world-tree") {
    const stamina = playerMaxStamina(player);
    const gain = Math.floor(stamina / 2) * 3;
    applyScoreChange(playerIndex, "concrete", gain, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    player.worldTreeActive = true;
    player.worldTreeStartRound = game.round;
    appendLog(`${player.name} 打出「世界树」：爆肝${stamina}点，具象动效+${gain}。`, "effect");
  } else if (definition.id === "you-suffer") {
    target.youSufferTurn = true;
    appendLog(`${player.name} 对${target.name}打出「You Suffer」：其下一回合仅1秒。`, "effect");
  } else if (definition.id === "seven-trace") {
    return executeSevenTrace(playerIndex, cardUid);
  } else if (definition.id === "arithmetic") {
    openArithmeticQuestion(playerIndex);
  } else if (definition.id === "everything-unfinished") {
    return executeEverythingUnfinished(playerIndex, cardUid);
  }

  // 华彩重放：首次华彩牌效果额外执行一次（按维度差值重放）
  if (brilliantSnapshot) {
    game.turn.brilliantReplayed = true;
    game.players.forEach((p, i) => {
      DIMENSIONS.forEach(dim => {
        const delta = p.scores[dim] - brilliantSnapshot[i][dim];
        if (delta !== 0) {
          applyScoreChange(i, dim, delta, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
        }
      });
    });
    appendLog(`「华彩」：${player.name} 的牌效果重放一次。`, "effect");
  }

  if (definition.id !== "remap") {
    appendLog(`${player.name} 打出「${definition.name}」。`, "effect");
    if (!consumePlayedSkillCard(playerIndex, cardUid)) return fail("卡牌消耗失败");
  }
  game.turn.lastSkillCardId = definition.id;
  if (definition.id !== "seven-trace" && definition.id !== "arithmetic" && definition.id !== "everything-unfinished") {
    game.skillHistory.push({ cardId: definition.id, rarity: definition.rarity, round: game.round });
  }
  // 附魔效果
  applyEnchantEffects(playerIndex, card);
  if (player.beibeiSkipTurn) {
    player.beibeiSkipTurn = false;
    endTurn(playerIndex);
  }
  if (game.turn.skillCardsPlayed === 3 && ownsCharacter(player, "ziwei")) {
    drawCards(playerIndex, 1);
    appendLog(`${player.name} 在本回合打出第3张牌，抽1张牌。`, "effect");
  }
  return ok();
}

function handleNonPlayCardLoss(playerIndex, count) {
  const player = game.players[playerIndex];
  if (!player || !ownsCharacter(player, "two-three-eight") || count <= 0) return;
  const triggers = Math.min(count, 5 - player.counters.twoThreeEightLoss);
  for (let i = 0; i < triggers; i++) {
    player.counters.twoThreeEightLoss++;
    applyScoreChange(playerIndex, randomDimension(), 3, { sourcePlayerIndex: playerIndex });
  }
  if (triggers > 0) appendLog(`${player.name} 因非打出方式失去${triggers}张牌，随机维度获得加成。`, "effect");
}

function applyEnchantEffects(playerIndex, card) {
  const player = game.players[playerIndex];
  if (!player || !card || !card.enchant) return;
  if (card.enchant === "agile") {
    const dim = randomDimension(true);
    applyScoreChange(playerIndex, dim, 2, { sourcePlayerIndex: playerIndex, allowSelectionChange: true });
    appendLog(`「灵巧」：${player.name} 的${DIMENSION_LABELS[dim]}+2。`, "effect");
  } else if (card.enchant === "miracle") {
    drawCards(playerIndex, 1);
    appendLog(`「奇迹」：${player.name} 再摸1张牌。`, "effect");
  }
}

function executeSevenTrace(playerIndex, cardUid) {
  const player = game.players[playerIndex];
  const idx = player.hand.findIndex(c => c.uid === cardUid);
  if (idx < 0) return fail("手牌不存在");
  const [used] = player.hand.splice(idx, 1);
  game.discard.push(used);
  player.handCount = player.hand.length;
  if (!game.forcePlay) game.turn.skillCardsPlayed++;
  game.skillHistory.push({ cardId: "seven-trace", rarity: "blue", round: game.round });
  refillDeckIfNeeded();
  // 从牌堆抽最多7张 (稀有度, 类别) 组合唯一的技能牌
  const selected = [];
  const seen = new Set();
  for (let i = game.deck.length - 1; i >= 0 && selected.length < 7; i--) {
    const c = game.deck[i];
    if (c.type !== "skill") continue;
    const def = skillDefinition(c.cardId);
    if (!def) continue;
    const key = `${def.rarity}|${def.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(c);
    game.deck.splice(i, 1);
  }
  // 按总分降序排序玩家，循环分配
  const order = game.players.map((p, i) => ({ p, i }))
    .sort((a, b) => totalScore(b.p) - totalScore(a.p))
    .map(e => e.i);
  let cursor = 0;
  selected.forEach(card => {
    let assigned = false;
    for (let k = 0; k < order.length; k++) {
      const targetIdx = order[(cursor + k) % order.length];
      const target = game.players[targetIdx];
      if (target.hand.length < (target.handLimit ?? 5)) {
        target.hand.push(card);
        target.handCount = target.hand.length;
        appendLog(`${target.name} 从「七迹」中获得了「${skillDefinition(card.cardId)?.name || "牌"}」。`, "effect");
        cursor = (cursor + k + 1) % order.length;
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      game.discard.push(card);
      appendLog("「七迹」：有牌因无人可收被弃置。", "event");
    }
  });
  appendLog(`${player.name} 打出「七迹」，抽取${selected.length}张牌并分配。`, "effect");
  return ok();
}

// 根据卡牌定义自动构造一份可用的打出 payload（供「一切未竟」强制打出复用）。
// 无法构造合法目标时返回 null。
function autoCardPayload(playerIndex, cardUid, definition) {
  const player = game.players[playerIndex];
  const payload = { cardUid };
  if (definition?.targetMode === TARGET_MODE.PLAYER || definition?.targetMode === TARGET_MODE.PLAYER_AND_DIMENSION) {
    const targetIndex = botTargetIndex(playerIndex);
    if (targetIndex < 0) return null;
    payload.targetMemberId = game.players[targetIndex].memberId;
    if (definition.targetMode === TARGET_MODE.PLAYER_AND_DIMENSION) {
      payload.dimension = randomItem(CHANGEABLE_DIMENSIONS);
    }
  } else if (definition?.targetMode === TARGET_MODE.OWN_DIMENSION) {
    payload.dimension = randomItem(CHANGEABLE_DIMENSIONS);
  } else if (definition?.targetMode === TARGET_MODE.OWN_AND_OPPONENT_CHARACTERS) {
    const ownChar = player.characters.find(c => !c.permanentlyDisabled && c.disabledTurns === 0);
    if (!ownChar) return null;
    payload.ownCharacterUid = ownChar.uid;
    const targetUids = [];
    for (const opp of game.players) {
      if (opp.memberId === player.memberId) continue;
      for (const c of opp.characters) {
        if (targetUids.length < 3) targetUids.push(c.uid);
      }
    }
    if (targetUids.length < 2) return null;
    payload.targetCharacterUids = targetUids.slice(0, 2 + Math.floor(Math.random() * 2));
  } else if (definition?.targetMode === TARGET_MODE.OWN_CHARACTER) {
    const targetChar = player.characters.find(c => !c.permanentlyDisabled && (c.disabledTurns > 0 || Object.values(c.cooldowns || {}).some(v => v > 0)));
    if (!targetChar) return null;
    payload.characterUid = targetChar.uid;
  } else if (definition?.targetMode === TARGET_MODE.ANY_CHARACTER) {
    const allChars = game.players.flatMap(p => p.characters).filter(c => !c.permanentlyDisabled);
    if (!allChars.length) return null;
    payload.characterUid = randomItem(allChars).uid;
  } else if (definition?.targetMode === TARGET_MODE.OWN_CHARACTER_AND_DIMENSION) {
    const ownChar = player.characters.find(c => !c.permanentlyDisabled);
    if (!ownChar) return null;
    payload.characterUid = ownChar.uid;
    payload.dimension = randomItem(CHANGEABLE_DIMENSIONS);
  } else if (definition?.targetMode === TARGET_MODE.OWN_AVAILABLE_CHARACTER) {
    const targetChar = player.characters.find(c => !c.permanentlyDisabled && c.disabledTurns === 0);
    if (!targetChar) return null;
    payload.characterUid = targetChar.uid;
  } else if (definition?.targetMode === TARGET_MODE.SELF_CARD) {
    const other = player.hand.find(c => c.uid !== cardUid && c.type !== "star");
    if (other) payload.discardUid = other.uid;
  } else if (definition?.target === "opponent") {
    const targetIndex = botTargetIndex(playerIndex);
    if (targetIndex < 0) return null;
    payload.targetMemberId = game.players[targetIndex].memberId;
  }
  return payload;
}

function executeEverythingUnfinished(playerIndex, cardUid) {
  const player = game.players[playerIndex];
  const idx = player.hand.findIndex(c => c.uid === cardUid);
  if (idx < 0) return fail("手牌不存在");
  const [used] = player.hand.splice(idx, 1);
  game.discard.push(used);
  player.handCount = player.hand.length;
  if (!game.forcePlay) game.turn.skillCardsPlayed++;
  game.skillHistory.push({ cardId: "everything-unfinished", rarity: "purple", round: game.round });
  const n = Math.min(game.round - 1, 8);
  if (n > 0) applyScoreChange(playerIndex, "abstract", n, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
  const priority = ["rainbow", "orange", "purple", "blue", "green", "white"];
  let bestCardId = null;
  let bestPriority = priority.length;
  game.skillHistory.forEach(h => {
    if (h.round >= game.round) return;
    // 避免重放「一切未竟」/「七迹」这类流程牌，防止递归或重复分配
    if (h.cardId === "everything-unfinished" || h.cardId === "seven-trace") return;
    const p = priority.indexOf(h.rarity);
    if (p >= 0 && p < bestPriority) { bestPriority = p; bestCardId = h.cardId; }
  });
  if (bestCardId) {
    // 自动生成一张该牌，加入手牌，并强制立刻打出
    const newCard = createCard("skill", bestCardId);
    player.hand.push(newCard);
    player.handCount = player.hand.length;
    const def = skillDefinition(bestCardId);
    const autoPayload = autoCardPayload(playerIndex, newCard.uid, def) || { cardUid: newCard.uid };
    const savedForce = game.forcePlay;
    game.forcePlay = true;
    let result;
    try {
      result = executeSkillCard(playerIndex, newCard.uid, autoPayload);
    } finally {
      game.forcePlay = savedForce;
    }
    if (!result.ok) {
      const di = player.hand.findIndex(c => c.uid === newCard.uid);
      if (di >= 0) {
        player.hand.splice(di, 1);
        game.discard.push(newCard);
        player.handCount = player.hand.length;
      }
      appendLog(`${player.name} 打出「一切未竟」：生成了「${def?.name || "牌"}」但无法打出，已弃置。`, "event");
    } else {
      appendLog(`${player.name} 打出「一切未竟」：生成并强制打出了历史卡色最高的「${def?.name || "牌"}」。`, "effect");
    }
  } else {
    appendLog(`${player.name} 打出「一切未竟」，但没有可回溯的历史技能牌。`, "event");
  }
  return ok();
}

function generateArithmeticQuestion(medium) {
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const make = (answer) => {
    if (medium) {
      const op = randomItem(["+", "-", "*"]);
      if (op === "+") { const b = randInt(5, 20); return { text: `${answer - b} + ${b}`, answer }; }
      if (op === "-") { const b = randInt(3, 10); return { text: `${answer + b} - ${b}`, answer }; }
      const b = randomItem([3, 9]); return { text: `${answer / b} × ${b}`, answer };
    }
    const op = randomItem(["+", "-"]);
    if (op === "+") { const b = randInt(1, 8); return { text: `${answer - b} + ${b}`, answer }; }
    const b = randInt(1, 5); return { text: `${answer + b} - ${b}`, answer };
  };
  const correctIndex = Math.floor(Math.random() * 3);
  const questions = [];
  for (let i = 0; i < 3; i++) {
    if (i === correctIndex) questions.push(make(9));
    else {
      let wrong;
      do { wrong = randInt(3, 15); } while (wrong === 9);
      questions.push(make(wrong));
    }
  }
  return { questions, correctIndex };
}

function openArithmeticQuestion(playerIndex) {
  const player = game.players[playerIndex];
  if (!player) return;
  const medium = ownsCharacter(player, "sulfur");
  const timeLimit = medium ? 15000 : 5000;
  game.arithmetic = {
    playerIndex,
    medium,
    ...generateArithmeticQuestion(medium),
    expiresAt: Date.now() + timeLimit
  };
  appendLog(`${player.name} 面临「算数教室」的挑战。`, "event");
}

function resolveArithmetic(playerIndex, selectedIndex) {
  if (!game.arithmetic || game.arithmetic.playerIndex !== playerIndex) return fail("没有待作答的算术题");
  const arith = game.arithmetic;
  const player = game.players[playerIndex];
  const correct = Number(selectedIndex) === arith.correctIndex;
  const hasSulfur = ownsCharacter(player, "sulfur");
  if (correct) {
    applyScoreChange(playerIndex, "concrete", 9, { sourcePlayerIndex: playerIndex, fromSkillCard: true });
    if (hasSulfur) {
      DIMENSIONS.forEach(dim => applyScoreChange(playerIndex, dim, 9, { sourcePlayerIndex: playerIndex, allowSelectionChange: true }));
      appendLog(`${player.name} 答对算术题（SulfurDXD加成）：具象+9，六维各+9。`, "effect");
    } else {
      appendLog(`${player.name} 答对算术题：具象动效+9。`, "effect");
    }
  } else {
    const dim = randomDimension(true);
    applyScoreChange(playerIndex, dim, -9, { sourcePlayerIndex: playerIndex, allowSelectionChange: true });
    player.arithmeticPending = true;
    appendLog(`${player.name} 算术题答错或超时：${DIMENSION_LABELS[dim]}-9，下回合将重新出题。`, "event");
  }
  game.arithmetic = null;
  return ok();
}

function executeReviewVote(playerIndex, payload = {}) {
  const player = game.players[playerIndex];
  if (game.round === 1) return fail("第1轮不能使用技能牌");
  if (player.reviewTurns <= 0) return fail("当前没有评议身份");
  if (player.reviewActionUsed) return fail("本回合已经进行过评议");
  if (isAllSkillBlocked(player)) return fail("本回合不能发动技能");
  const targetIndex = game.players.findIndex(candidate => candidate.memberId === payload.targetMemberId);
  const target = game.players[targetIndex];
  if (!target) return fail("目标不存在");
  if (payload.vote === "red") {
    applyScoreChange(targetIndex, "config", 10, {
      sourcePlayerIndex: playerIndex,
      fromSkillCard: true
    });
    target.disableCharacterTurns = Math.max(target.disableCharacterTurns, 2);
    gainReputation(playerIndex, -1);
    appendLog(`${player.name} 向${target.name}送出红票：配置水平+10，连续2回合不可发动角色技能，自己声望-1。`, "effect");
    if (target.characters.some(c => c.id === "hotwind" || c.id === "dagezi")) {
      player.counters.redVotesToHotwindDagezi = (player.counters.redVotesToHotwindDagezi || 0) + 1;
      if (player.counters.redVotesToHotwindDagezi >= 2) {
        player.counters.redVotesToHotwindDagezi = 0;
        const burstCard = createCard("skill", "burst");
        target.hand.push(burstCard);
        target.handCount = target.hand.length;
        appendLog(`${target.name} 累计收到两次红票，获得一张「跟你爆了！！！」。`, "effect");
      }
    }
  } else if (payload.vote === "green") {
    gainReputation(targetIndex, 1);
    gainReputation(playerIndex, 2);
    drawCards(playerIndex, 1, true);
    appendLog(`${player.name} 向${target.name}送出绿票：对方声望+1，自己声望+2并抽1张牌。`, "effect");
  } else {
    return fail("请选择红票或绿票");
  }
  player.reviewActionUsed = true;
  return ok();
}

function endTurn(playerIndex) {
  const player = game.players[playerIndex];
  if (game.round === 1) {
    if (!player.firstRoundSkillUsed) return fail("第1轮必须发动1次角色技能");
  } else if (!game.turn.hasDrawn) {
    return fail("必须先完成摸牌");
  }
  if (player.disableCharacterTurns > 0) player.disableCharacterTurns--;
  if (player.disableAllSkillTurns > 0) player.disableAllSkillTurns--;
  if (player.reviewTurns > 0) player.reviewTurns--;
  player.skillCardLimit = null;
  player.characters.forEach(character => {
    if (character.disabledTurns > 0) character.disabledTurns--;
  });
  if (player.pendingDisableCharacterTurns > 0) {
    player.disableCharacterTurns = Math.max(player.disableCharacterTurns, player.pendingDisableCharacterTurns);
    player.pendingDisableCharacterTurns = 0;
  }

  // 存货积压：从第4轮起，回合结束时手牌>0则随机维度扣除当前手牌数
  if (globalModifierActive("stockpile") && game.round >= 4 && player.hand.length > 0) {
    const penalty = player.hand.length;
    const dimension = randomDimension(true);
    applyScoreChange(playerIndex, dimension, -penalty, {
      sourcePlayerIndex: playerIndex,
      allowSelectionChange: true,
      skipStarPending: true
    });
    appendLog(`「存货积压」：${player.name} 回合结束，手牌${penalty}张，${DIMENSION_LABELS[dimension]}-${penalty}。`, "event");
  }

  if (
    player.extraTurnCredits > 0 &&
    player.extraTurnEligibleAfter != null &&
    game.turn.number > player.extraTurnEligibleAfter
  ) {
    player.extraTurnCredits--;
    if (player.extraTurnCredits <= 0) player.extraTurnEligibleAfter = null;
    appendLog(`${player.name} 获得一个额外回合。`, "event");
    beginTurn();
    return ok();
  }

  if (game.turnDirection === -1) {
    if (game.currentPlayerIndex > 0) {
      game.currentPlayerIndex--;
    } else {
      game.turnDirection = 1;
      game.currentPlayerIndex = game.players.length > 1 ? 1 : 0;
      appendLog("凌日潮汐结束，恢复正常行动顺序。", "event");
    }
  } else {
    game.currentPlayerIndex++;
    if (game.currentPlayerIndex >= game.players.length) {
      game.currentPlayerIndex = 0;
      game.round++;
      const shouldSettle = globalModifierActive("roulette")
        ? (game.round > game.totalRounds * 2) ||
          (game.rouletteFinalRound != null && game.round > game.rouletteFinalRound)
        : game.round > game.totalRounds;
      if (shouldSettle) {
        settleGame();
        return ok();
      }
      if (globalModifierActive("roulette") && game.rouletteFinalRound == null) {
        const roll = 1 + Math.floor(Math.random() * game.totalRounds);
        if (roll === game.totalRounds) {
          game.rouletteFinalRound = game.round;
          appendLog(`「俄罗斯轮盘」：第${game.round}轮被随机决定为最终轮。`, "event");
        }
      }
      appendLog(`第${game.round}轮开始。`, "event");
    }
  }
  // 跳过下一回合（如「电脑被没收了」事件）
  if (currentPlayer().skipNextTurn) {
    const skipped = currentPlayer();
    skipped.skipNextTurn = false;
    if (skipped.computerRemovedBonus) {
      skipped.computerRemovedBonus = false;
      skipped.characters.forEach(character => {
        character.staminaBonus = (character.staminaBonus || 0) + 2;
      });
      appendLog(`${skipped.name} 的爆肝程度+2。`, "effect");
    }
    appendLog(`${skipped.name} 的回合被跳过。`, "event");
    return endTurn(game.currentPlayerIndex);
  }
  beginTurn();
  return ok();
}

function settleGame() {
  const preliminary = game.players
    .map((player, index) => ({ index, score: totalScore(player) }))
    .sort((a, b) => b.score - a.score);
  preliminary.forEach((entry, rankIndex) => {
    const player = game.players[entry.index];
    if (!ownsCharacter(player, "dagezi") || rankIndex === 0) return;
    const gap = preliminary[rankIndex - 1].score - entry.score;
    const triggers = Math.floor(gap / 3);
    for (let i = 0; i < triggers; i++) {
      const opponents = game.players.map((_, index) => index).filter(index => index !== entry.index && !game.players[index].frozen);
      if (!opponents.length) break;
      const targetIndex = randomItem(opponents);
      game.players[targetIndex].settlementPenalty -= 2;
      appendLog(`${player.name} 的结算被动使${game.players[targetIndex].name}综合分-2。`, "effect");
    }
  });
  game.phase = GAME_PHASE.SETTLEMENT;
  game.ranking = game.players
    .map(player => ({
      memberId: player.memberId,
      name: player.name,
      score: totalScore(player),
      scores: clone(player.scores),
      reputation: player.reputation,
      storyboard: player.storyboard,
      settlementPenalty: player.settlementPenalty
    }))
    .sort((a, b) => b.score - a.score);
  room.lifecycle = ROOM_STATE.SETTLEMENT;
  appendLog("全部回合结束，进入结算。", "event");
}

function validateActor(memberId) {
  const index = game?.players.findIndex(player => player.memberId === memberId) ?? -1;
  if (index < 0) return { index, error: fail("观战者不能操作") };
  return { index, error: null };
}

function hostDispatch(memberId, action, payload = {}, requestId = "", internalCall = false) {
  if (!room.isHost || !game || room.lifecycle !== ROOM_STATE.PLAYING) return fail("游戏当前不可操作");
  const actor = validateActor(memberId);
  if (actor.error) return actor.error;
  const playerIndex = actor.index;
  const player = game.players[playerIndex];
  // AI 托管的真人玩家不允许远端手动操作（内部 AI 执行时 internalCall 跳过此检查）
  if (!player.isBot && player.aiControlled && !internalCall) return fail("该玩家已由 AI 永久托管");
  const ownTurn = game.currentPlayerIndex === playerIndex;
  let result = fail("未知操作");

  if (game.pendingEvent && action !== "RESOLVE_EVENT" && action !== "RESOLVE_STAR_MITIGATION" && action !== "ANSWER_ARITHMETIC" && action !== "OVERTURE_REDUCE" && action !== "OVERTURE_DISCARD" && action !== "DYSTOPIA_OFFSET") {
    return fail("请先完成当前事件牌结算");
  }
  if (action === "RESOLVE_EVENT") {
    result = resolvePendingEvent(memberId, payload);
  } else if (action === "RESOLVE_STAR_MITIGATION") {
    result = resolveStarMitigation(memberId, payload.accept === true);
  } else if (action === "DRAFT_BUY") {
    if (game.phase !== GAME_PHASE.DRAFT || !ownTurn) return fail("还没轮到你购置");
    result = buyCharacter(playerIndex, payload.characterId);
  } else if (action === "DRAFT_DONE") {
    if (game.phase !== GAME_PHASE.DRAFT || !ownTurn) return fail("还没轮到你购置");
    result = finishDraft(playerIndex);
  } else if (action === "DRAW") {
    if (game.phase !== GAME_PHASE.TURN || !ownTurn) return fail("现在不能摸牌");
    if (game.round === 1) return fail("第1轮不摸牌");
    if (game.turn.hasDrawn) return fail("本回合已经摸过牌");
    if (player.hand.length >= (player.handLimit ?? 5)) return fail("手牌已满，请先使用或弃牌");
    game.turn.hasDrawn = true;
    if (globalModifierActive("stockpile")) {
      const count = Math.min(3, Math.max(0, (player.handLimit ?? 5) - player.hand.length));
      const results = drawCards(playerIndex, count);
      result = ok({ draw: { kind: "multiple", count, results } });
    } else {
      result = ok({ draw: drawCard(playerIndex) });
    }
  } else if (action === "PLAY_CARD") {
    if (game.phase !== GAME_PHASE.TURN || !ownTurn) return fail("只能在自己的回合使用技能牌");
    result = executeSkillCard(playerIndex, payload.cardUid, payload);
  } else if (action === "DISCARD_CARD") {
    if (game.phase !== GAME_PHASE.TURN || !ownTurn) return fail("只能在自己的回合弃牌");
    result = discardCard(playerIndex, payload.cardUid);
  } else if (action === "ACTIVATE_CHARACTER") {
    if (game.phase !== GAME_PHASE.TURN || !ownTurn) return fail("只能在自己的回合发动角色技能");
    result = activateCharacter(playerIndex, payload.characterId, payload.abilityId, payload);
  } else if (action === "REVIEW_VOTE") {
    if (game.phase !== GAME_PHASE.TURN || !ownTurn) return fail("只能在自己的回合进行评议");
    result = executeReviewVote(playerIndex, payload);
  } else if (action === "RESTORE_CHARACTER") {
    if (game.phase !== GAME_PHASE.TURN || !ownTurn) return fail("只能在自己的回合恢复角色");
    const instance = player.characters.find(c => c.uid === payload.characterUid);
    if (!instance) return fail("未找到该角色");
    if (!instance.permanentlyDisabled && instance.disabledTurns <= 0) return fail("该角色技能未被禁用，无需恢复");
    if (player.reputation < 10) return fail("声望不足 10 点");
    const wasPermanent = instance.permanentlyDisabled;
    const origTurns = instance.disabledTurns;
    gainReputation(playerIndex, -10);
    instance.permanentlyDisabled = false;
    instance.disabledTurns = 0;
    const def = characterDefinition(instance.id);
    appendLog(`${player.name} 花费 10 点声望使「${def.name}」立即恢复可用状态（原状态：${wasPermanent ? "永久失效" : `禁用${origTurns}回合`}）。`, "effect");
    result = ok();
  } else if (action === "END_TURN") {
    if (game.phase !== GAME_PHASE.TURN || !ownTurn) return fail("现在不能结束回合");
    result = endTurn(playerIndex);
  } else if (action === "ANSWER_ARITHMETIC") {
    result = resolveArithmetic(playerIndex, payload.selectedIndex);
  } else if (action === "DYSTOPIA_OFFSET") {
    result = offsetDystopia(playerIndex, payload.cardUid);
  } else if (action === "OVERTURE_REDUCE") {
    result = overtureReduce(playerIndex);
  } else if (action === "OVERTURE_DISCARD") {
    result = overtureDiscard(playerIndex);
  }

  if (result.ok) {
    game.sequence++;
    if (player) player.lastActionAt = Date.now();
    commitGameState(action, memberId, requestId, result);
  }
  return result;
}

function botTargetIndex(playerIndex) {
  const candidates = game.players
    .map((player, index) => ({ player, index }))
    .filter(entry => entry.index !== playerIndex);
  if (!candidates.length) return -1;
  const bot = game.players[playerIndex];
  if (bot.difficulty === "normal") {
    candidates.sort((a, b) => totalScore(b.player) - totalScore(a.player));
    return candidates[0].index;
  }
  return randomItem(candidates).index;
}

function botAbilityPayload(playerIndex, instance, ability) {
  if (ability.choice === "three-dimensions") {
    return { dimensions: shuffle([...CHANGEABLE_DIMENSIONS]).slice(0, 3) };
  }
  if (ability.choice === "two-dimensions") {
    return { dimensions: shuffle([...CHANGEABLE_DIMENSIONS]).slice(0, 2) };
  }
  if (ability.choice === "motion-distribution") {
    return { abstractPoints: Math.floor(Math.random() * 6) };
  }
  if (ability.choice === "up-to-two-targets") {
    const targets = game.players
      .filter((_, index) => index !== playerIndex)
      .sort((a, b) => totalScore(b) - totalScore(a))
      .slice(0, 2)
      .map(player => player.memberId);
    return { targetMemberIds: targets };
  }
  if (ability.choice === "opponent") {
    const targetIndex = botTargetIndex(playerIndex);
    return { targetMemberId: game.players[targetIndex]?.memberId };
  }
  if (ability.choice === "opponent-card") {
    const targetIndex = botTargetIndex(playerIndex);
    const targetPlayer = game.players[targetIndex];
    const whiteGreen = (targetPlayer?.hand || []).filter(c => {
      const def = skillDefinition(c.cardId);
      return def && (def.rarity === "white" || def.rarity === "green");
    });
    if (!whiteGreen.length) return {};
    return { targetMemberId: targetPlayer.memberId, targetCardUid: randomItem(whiteGreen).uid };
  }
  if (ability.choice === "discard-cards") {
    const skillCards = player.hand.filter(c => c.type !== "star");
    if (!skillCards.length) return {};
    const count = Math.min(3, skillCards.length);
    return { discardUids: shuffle(skillCards).slice(0, count).map(c => c.uid) };
  }
  if (ability.choice === "rarity") {
    const rarities = Object.keys(SKILL_RARITY).filter(r => player.hand.some(c => c.type !== "star" && skillDefinition(c.cardId)?.rarity === r));
    return rarities.length ? { rarity: randomItem(rarities) } : {};
  }
  if (ability.choice === "own-peak-dimension") {
    return {};
  }
  return {};
}

function botCharacterChoice(playerIndex) {
  const player = game.players[playerIndex];
  const affordable = CHARACTERS.filter(character =>
    !player.characters.some(instance => instance.id === character.id) &&
    RARITY[character.rarity].price <= player.funds
  );
  if (!affordable.length) return null;
  if (player.difficulty === "simple") {
    const highestPrice = Math.max(...affordable.map(character => RARITY[character.rarity].price));
    return randomItem(affordable.filter(character => RARITY[character.rarity].price === highestPrice));
  }
  const strategyStats = {
    config: ["config", "stamina"],
    motion: ["abstract", "concrete"],
    innovation: ["innovation", "stamina"],
    selection: ["selection", "config"]
  }[player.aiStrategy] || ["config", "innovation"];
  return affordable.sort((a, b) => {
    const statsA = characterStats(a.id);
    const statsB = characterStats(b.id);
    const scoreA = strategyStats.reduce((sum, stat) => sum + statsA[stat], 0);
    const scoreB = strategyStats.reduce((sum, stat) => sum + statsB[stat], 0);
    return scoreB - scoreA || RARITY[b.rarity].price - RARITY[a.rarity].price;
  })[0];
}

function resolveBotEvent(playerIndex) {
  const pending = game.pendingEvent;
  const player = game.players[playerIndex];
  if (!pending || pending.responderMemberId !== player.memberId) return fail("没有待处理事件");
  let result;
  if (pending.stage === "choose") {
    const targetIndex = botTargetIndex(playerIndex);
    result = hostDispatch(player.memberId, "RESOLVE_EVENT", {
      ownCharacterUid: pending.eventId === "maimai" ? null : randomItem(player.characters)?.uid,
      targetMemberId: game.players[targetIndex]?.memberId
    }, "", true);
  } else {
    const targetCharacterUid = randomItem(player.characters)?.uid;
    if (pending.eventId === "maimai") {
      result = hostDispatch(player.memberId, "RESOLVE_EVENT", { targetCharacterUid }, "", true);
    } else {
      const decision = player.difficulty === "normal" || Math.random() < .65 ? "accept" : "refuse";
      result = hostDispatch(player.memberId, "RESOLVE_EVENT", { decision, targetCharacterUid }, "", true);
    }
  }
  // 若 hostDispatch 失败（如角色 uid 无效），不会触发 commitGameState，需手动重试避免卡死
  if (!result.ok) {
    // choose 阶段失败：强制选择第一个可用目标重试一次；仍失败则放弃事件
    if (pending.stage === "choose") {
      const fallbackTarget = game.players.find((p, i) => i !== playerIndex);
      if (fallbackTarget) {
        const fallbackChar = player.characters[0];
        const retry = hostDispatch(player.memberId, "RESOLVE_EVENT", {
          ownCharacterUid: fallbackChar?.uid,
          targetMemberId: fallbackTarget.memberId
        }, "", true);
        if (retry.ok) return retry;
      }
    }
    // 仍失败：放弃当前事件，避免永久卡死
    appendLog(`${player.name} 无法处理事件「${eventDefinition(pending.eventId)?.name}」，事件被跳过。`, "event");
    game.pendingEvent = null;
    commitGameState("SYNC", "system", "", null);
    scheduleBotAction();
    return ok();
  }
  return result;
}

function isAIActor(player) {
  return player?.isBot || player?.aiControlled;
}

const botContext = {
  actionId: null,
  playerId: null,
  state: "IDLE",
  committed: false,
  startedAt: 0
};

function performBotAction() {
  ui.botTimer = null;
  if (!room.isHost || !game || room.lifecycle !== ROOM_STATE.PLAYING) return;
  // 机器人自动处理【星】抵消
  if (game.pendingStarMitigation) {
    const starPlayer = game.players.find(p => p.memberId === game.pendingStarMitigation.memberId);
    if (starPlayer && isAIActor(starPlayer)) {
      const r = resolveStarMitigation(starPlayer.memberId, true);
      if (r.ok) commitGameState("RESOLVE_STAR_MITIGATION", "system", "", null);
      else game.pendingStarMitigation = null;
      scheduleBotAction();
      return;
    }
  }
  const pendingIndex = game.pendingEvent
    ? game.players.findIndex(player => player.memberId === game.pendingEvent.responderMemberId && isAIActor(player))
    : -1;
  if (pendingIndex >= 0) {
    try {
      resolveBotEvent(pendingIndex);
    } catch (e) {
      console.error("[BOT] resolveBotEvent threw:", e);
    }
    scheduleBotAction();
    return;
  }
  if (game.pendingEvent) return;

  const playerIndex = game.currentPlayerIndex;
  const player = game.players[playerIndex];
  if (!isAIActor(player)) return;

  botContext.playerId = player.memberId;
  botContext.state = "EXECUTING";
  botContext.committed = false;
  botContext.startedAt = Date.now();
  botContext.actionId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  try {
    const dispatch = (action, payload = {}) => {
      const result = hostDispatch(player.memberId, action, payload, "", true);
      if (result.ok) {
        botContext.committed = true;
        botContext.state = "COMMITTED";
      } else if (!result.ok && action !== "END_TURN" && action !== "DRAFT_DONE") {
        console.log(`[BOT] action=${action} failed: ${result.reason}`);
      }
      return result;
    };

    if (game.phase === GAME_PHASE.DRAFT) {
      const choice = botCharacterChoice(playerIndex);
      dispatch(choice ? "DRAFT_BUY" : "DRAFT_DONE", choice ? { characterId: choice.id } : {});
      return;
    }

    if (game.round === 1) {
      if (!player.firstRoundSkillUsed) {
        const choice = player.characters
          .flatMap(instance => characterDefinition(instance.id).abilities.map(ability => ({ instance, ability })))
          .find(entry => canActivateCharacter(player, entry.instance, entry.ability).ok);
        if (choice) {
          dispatch("ACTIVATE_CHARACTER", {
            characterId: choice.instance.id,
            abilityId: choice.ability.id,
            ...botAbilityPayload(playerIndex, choice.instance, choice.ability)
          });
          return;
        }
      }
      dispatch("END_TURN");
      return;
    }

    if (!game.turn.hasDrawn) {
      dispatch("DRAW");
      return;
    }

    if (player.reviewTurns > 0 && !player.reviewActionUsed && !isAllSkillBlocked(player)) {
      const targetIndex = player.difficulty === "normal" ? botTargetIndex(playerIndex) : Math.floor(Math.random() * game.players.length);
      dispatch("REVIEW_VOTE", {
        targetMemberId: game.players[targetIndex].memberId,
        vote: player.difficulty === "normal" ? "red" : randomItem(["red", "green"])
      });
      return;
    }

    const abilityChoice = player.characters
      .flatMap(instance => characterDefinition(instance.id).abilities.map(ability => ({ instance, ability })))
      .find(entry => canActivateCharacter(player, entry.instance, entry.ability).ok);
    if (abilityChoice) {
      dispatch("ACTIVATE_CHARACTER", {
        characterId: abilityChoice.instance.id,
        abilityId: abilityChoice.ability.id,
        ...botAbilityPayload(playerIndex, abilityChoice.instance, abilityChoice.ability)
      });
      return;
    }

    const cardLimit = player.difficulty === "normal" ? 2 : 1;
    if (game.turn.skillCardsPlayed < cardLimit && !isAllSkillBlocked(player)) {
      const priorityMap = { fge: 0, commission: 1, review: 2, drink: 3 };
      const sortedHand = [...player.hand].sort((a, b) =>
        (priorityMap[a.cardId] ?? 999) - (priorityMap[b.cardId] ?? 999)
      );
      for (const card of sortedHand) {
        if (card.type === "star") continue;
        const payload = { cardUid: card.uid };
        const def = skillDefinition(card.cardId);
        if (def?.targetMode === TARGET_MODE.PLAYER || def?.targetMode === TARGET_MODE.PLAYER_AND_DIMENSION) {
          payload.targetMemberId = game.players[botTargetIndex(playerIndex)].memberId;
          if (def.targetMode === TARGET_MODE.PLAYER_AND_DIMENSION) {
            payload.dimension = randomItem(CHANGEABLE_DIMENSIONS);
          }
        } else if (def?.targetMode === TARGET_MODE.OWN_DIMENSION) {
          payload.dimension = randomItem(CHANGEABLE_DIMENSIONS);
        } else if (def?.targetMode === TARGET_MODE.OWN_AND_OPPONENT_CHARACTERS) {
          const ownChar = player.characters.find(c => !c.permanentlyDisabled && c.disabledTurns === 0);
          if (!ownChar) continue;
          payload.ownCharacterUid = ownChar.uid;
          const opponents = game.players.filter((_, i) => i !== playerIndex);
          const targetUids = [];
          for (const opp of opponents) {
            for (const c of opp.characters) {
              if (targetUids.length < 3) targetUids.push(c.uid);
            }
          }
          if (targetUids.length < 2) continue;
          payload.targetCharacterUids = targetUids.slice(0, 2 + Math.floor(Math.random() * 2));
        } else if (def?.targetMode === TARGET_MODE.OWN_CHARACTER) {
          const targetChar = player.characters.find(c => !c.permanentlyDisabled && (c.disabledTurns > 0 || Object.values(c.cooldowns || {}).some(v => v > 0)));
          if (!targetChar) continue;
          payload.characterUid = targetChar.uid;
        } else if (def?.targetMode === TARGET_MODE.ANY_CHARACTER) {
          const allChars = game.players.flatMap(p => p.characters).filter(c => !c.permanentlyDisabled);
          if (!allChars.length) continue;
          payload.characterUid = randomItem(allChars).uid;
        } else if (def?.targetMode === TARGET_MODE.OWN_CHARACTER_AND_DIMENSION) {
          const ownChar = player.characters.find(c => !c.permanentlyDisabled);
          if (!ownChar) continue;
          payload.characterUid = ownChar.uid;
          payload.dimension = randomItem(CHANGEABLE_DIMENSIONS);
        } else if (def?.targetMode === TARGET_MODE.OWN_AVAILABLE_CHARACTER) {
          const targetChar = player.characters.find(c => !c.permanentlyDisabled && c.disabledTurns === 0);
          if (!targetChar) continue;
          payload.characterUid = targetChar.uid;
        } else if (def?.targetMode === TARGET_MODE.SELF_CARD) {
          const other = player.hand.find(c => c.uid !== card.uid && c.type !== "star");
          if (other) payload.discardUid = other.uid;
        } else if (def?.target === "opponent") {
          payload.targetMemberId = game.players[botTargetIndex(playerIndex)].memberId;
        }
        const result = dispatch("PLAY_CARD", payload);
        if (result.ok) return;
        if (botContext.committed) return;
      }
    }
    dispatch("END_TURN");
  } catch (error) {
    console.error("[BOT] action failed:", error);
    if (botContext.committed) {
      console.log("[BOT] committed, resume");
      botContext.state = "RECOVERING";
    } else {
      console.log("[BOT] retry");
      botContext.state = "RECOVERING";
      try {
        hostDispatch(player.memberId, "END_TURN", {}, "", true);
      } catch (e) {
        console.error("[BOT] END_TURN also failed:", e);
      }
    }
  } finally {
    botContext.state = "IDLE";
    try { render(); } catch (e) { console.error("[RENDER]", e); }
    scheduleBotAction();
  }
}

function scheduleBotAction() {
  clearTimeout(ui.botTimer);
  ui.botTimer = null;
  if (!room.isHost || !game || room.lifecycle !== ROOM_STATE.PLAYING) return;
  const pendingResponder = game.pendingEvent
    ? game.players.find(player => player.memberId === game.pendingEvent.responderMemberId)
    : (game.pendingStarMitigation
      ? game.players.find(player => player.memberId === game.pendingStarMitigation.memberId)
      : null);
  const actor = pendingResponder || currentPlayer();
  if (!isAIActor(actor)) return;
  const delay = actor.difficulty === "normal" ? 650 + Math.random() * 500 : 850 + Math.random() * 650;
  ui.botTimer = setTimeout(performBotAction, delay);
  clearTimeout(ui.botWatchdog);
  ui.botWatchdog = setTimeout(() => {
    if (!room.isHost || !game || room.lifecycle !== ROOM_STATE.PLAYING) return;
    const player = game.players[game.currentPlayerIndex];
    if (!isAIActor(player)) return;
    if (game.phase === GAME_PHASE.TURN) {
      if (game.pendingEvent) {
        const pendingIdx = game.players.findIndex(p => p.memberId === game.pendingEvent.responderMemberId && isAIActor(p));
        if (pendingIdx >= 0) {
          try {
            resolveBotEvent(pendingIdx);
          } catch (e) {
            console.error("[BOT] watchdog resolveBotEvent threw:", e);
          }
          scheduleBotAction();
          return;
        }
      }
      if (botContext.committed) {
        console.log("[BOT] watchdog: committed, reschedule");
        scheduleBotAction();
      } else {
        console.log("[BOT] watchdog: not committed, retry");
        performBotAction();
      }
    }
  }, 15000);
}

function publicGameFor(memberId) {
  if (!game) return null;
  const publicGame = clone(game);
  publicGame.players.forEach(player => {
    player.handCount = player.hand.length;
    if (player.memberId !== memberId) {
      player.hand = [];
      player.vitality = 0; // 生机为隐藏属性，仅自己可见
    } else {
      player.connected = true;
    }
  });
  return publicGame;
}

function publicRoom() {
  return {
    code: room.code,
    hostId: room.hostId,
    lifecycle: room.lifecycle,
    settings: clone(room.settings),
    members: clone(room.members)
  };
}

function applyRoomSnapshot(snapshot) {
  if (!snapshot) return;
  room.code = snapshot.code;
  room.hostId = snapshot.hostId;
  room.isHost = room.myId === snapshot.hostId;
  room.lifecycle = snapshot.lifecycle;
  room.settings = snapshot.settings;
  room.members = snapshot.members;
  room.connected = true;
  ui.hostLostAt = 0;
  ui.message = "";
  ui.messageError = false;
  ui.screen = room.lifecycle === ROOM_STATE.WAITING ? "lobby" : "game";
}

// ==================== SyncManager (Host + Client) ====================

function setAIControl(playerIndex, reason) {
  const player = game.players[playerIndex];
  if (player.isBot || player.aiControlled) return false;
  player.aiControlled = true;
  appendLog(`${player.name} ${reason}，由 AI 永久接管所有操作。`, "event");
  pushSystemChat(`${player.name} 已进入 AI 托管状态。`);
  return true;
}

function checkAIControl() {
  if (!game || game.phase === GAME_PHASE.SETTLEMENT) return;
  const now = Date.now();
  let changed = false;
  const wasCurrentAI = currentPlayer()?.aiControlled;
  game.players.forEach((player, playerIndex) => {
    if (player.isBot || player.aiControlled) return;
    // 1) 断线超过 90 秒 → AI 托管
    if (!player.connected && player.disconnectedAt && now - player.disconnectedAt >= DISCONNECT_AI_TIMEOUT_MS) {
      if (setAIControl(playerIndex, "断线超过 90 秒")) changed = true;
      return;
    }
    // 2) 轮到当前玩家且连续 120 秒未操作（即使未掉线）→ AI 托管（DRAFT 和 TURN 阶段）
    if (game.currentPlayerIndex === playerIndex &&
        (game.phase === GAME_PHASE.TURN || game.phase === GAME_PHASE.DRAFT)) {
      const lastAction = player.lastActionAt || player.disconnectedAt || now;
      if (now - lastAction >= INACTIVE_AI_TIMEOUT_MS) {
        if (setAIControl(playerIndex, "超过 120 秒未操作")) changed = true;
      }
    }
  });
  if (changed) {
    // 如果当前玩家刚被设为AI托管，立即启动AI行动
    const cur = currentPlayer();
    if (cur && cur.aiControlled && !wasCurrentAI) {
      scheduleBotAction();
    }
    commitGameState("AI_CONTROL", "system", "", null);
  }
}

function startGame() {
  const players = roomPlayers().filter(member => member.connected);
  if (room.lifecycle !== ROOM_STATE.WAITING) return;
  if (players.length < 2) return showToast("至少需要2名玩家");
  const globalModifier = room.settings.globalStateEnabled ? randomItem(GLOBAL_MODIFIERS).id : null;
  game = createGameState(players, room.settings.totalRounds, globalModifier);
  processedGameActions.clear();
  room.lifecycle = ROOM_STATE.PLAYING;
  appendLog(`游戏开始，共${game.totalRounds}轮。每位玩家拥有${game.players[0]?.funds ?? 12}点购置点数。`, "event");
  if (globalModifier) {
    const modifier = globalModifierDefinition(globalModifier);
    appendLog(`全局状态生效：【${modifier.name}】${modifier.description}`, "event");
  }
  pushSystemChat("游戏已开始，祝大家好运！");
  commitGameState("SYNC", "system", "", null);
}

function resetToLobby() {
  game = null;
  processedGameActions.clear();
  clearTimeout(ui.hostPeriodicTimer);
  ui.hostPeriodicTimer = null;
  clearPendingEvents(0);
  room.lifecycle = ROOM_STATE.WAITING;
  const connected = room.members
    .filter(member => member.connected)
    .sort((a, b) => Number(b.id === room.hostId) - Number(a.id === room.hostId));
  room.members = connected.map(member => ({
    ...member,
    spectator: false
  }));
  broadcastLobby();
}
