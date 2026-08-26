"use strict";

const VERSION = "v2.2.2";
const CHANGELOG = Object.freeze([
  { version: "v2.2.2", items: [
    "新增：手牌上限系统（上限 = ceil(所有角色爆肝程度均值 + 5)，随角色购置动态更新）",
    "新增：初始手牌按 min(5, 手牌上限) 发放；摸牌按钮在手牌满时禁用",
    "新增：卡牌「弃牌」「信息」按钮；主动弃牌会减少本回合可打出的牌数",
    "新增：本回合可打出牌数 = 手牌上限 - 已弃牌数；非常规摸牌后手牌溢出强制打出，需选对象的牌直接弃置"
  ]},
  { version: "v2.2.1", items: [
    "修复：我就不写谱、杂技改为弹出选择框（分别选择角色/弃置牌），不再随机",
    "修复：柳橙汁3743技能改为两步选择（先选玩家再选白/绿技能牌），不再随机抽取",
    "修复：我是脚健我很脚健技能完全无效果——补全实现（弃置至多3张技能牌并抽等量）",
    "修复：子阳技能完全无效果——补全实现（每2点创新获得1点抽象+1点具象）并实现具象提升翻倍被动",
    "修复：吃马虎旧被动仍生效——移除配置减半与配置+8旧被动，改为其他玩家回合内维度被改变时声望+1",
    "修复：机器人卡住——补充星抵消挂起时机器人的调度，避免未决状态卡死"
  ]},
  { version: "v2.2.0", items: [
    "内容更新：按实装内容变更清单调整29项技能牌，新增6张技能牌（贝贝、我提交了二十张DCC、kkp、已关闭评论区、撞星、里门）",
    "内容更新：调整5项事件牌（面基、打舞萌、崩所有人RPE、电脑被没收了、谱面找不到了）",
    "内容更新：调整14项角色牌，新增角色「子阳」",
    "新增联动：打舞萌取消发起者选角色、电脑被没收了爆肝+2、已关闭评论区负面技能免疫/维度锁定、二十张DCC声望保护、里门静默状态、贝贝跳过回合与节目效果",
    "实装：「撞星」将右方手牌替换为【星】特殊牌，星可在受减分时抵消（每8点具象动效抵消1点）",
    "交互：星抵消改为手动弹窗确认，新增 RESOLVE_STAR_MITIGATION 动作，机器人自动处理"
  ]},
  { version: "v2.1.3", items: [
    "修复：塔之诅咒技能牌依然无法手动选择角色——renderActionModal中me变量未定义",
    "修复：机器人在打出「我就不写谱」后卡住不动——resolveBotEvent在try/catch外部，异常导致scheduleBotAction永不被调用",
    "修复：broadcastStateEvent中render()异常阻断bot调度——包裹try/catch",
    "修复：机器人不支持OWN_AND_OPPONENT_CHARACTERS目标模式——添加对应出牌逻辑",
    "实装：「我就不写谱」技能牌效果——选1个可用技能角色重置为不可用，抽2张牌"
  ]},
  { version: "v2.1.2", items: [
    "修复：所有带选角色的功能无法选角色——processSyncQueue中else if改为独立if，防止非匹配requestId阻断pendingRequest清除",
    "修复：大鸽子声望上限15——移除cap参数，声望可无限增长",
    "修复：发力应选择自己属性而非其他玩家——改为OWN_DIMENSION模式，玩家选自己属性，系统自动随机目标"
  ]},
  { version: "v2.1.1", items: [
    "修复：柳橙汁3743技能使用后进入冷却但无效果——补充缺失的技能执行分支",
    "修复：发力无法选择目标属性——改为玩家选择目标+属性（PLAYER_AND_DIMENSION）",
    "修复：Remap点击后无反应——先完整弃牌再完整抽牌，不走cardIndex",
    "修复：塔之诅咒无法手动选择角色——改为玩家选择自身1张+其他2~3张角色",
    "修复：随机数写谱所有维度被设为同一值——每维度独立随机来源",
    "重构：技能牌统一targetMode框架，新增consumePlayedSkillCard统一消耗函数",
    "重构：Bot状态机（botContext/committed/watchdog/异常恢复/render解耦）"
  ]},
  { version: "v2.0.1", items: [
    "调整：牌堆构成比例由原约69%事件牌/31%技能牌调整为30%事件牌/70%技能牌"
  ]},
  { version: "v2.0.0", items: [
    "重构：联机同步层全面重构，采用权威状态 + 顺序状态事件 + 缺号补发 + 完整快照恢复架构",
    "新增：SyncManager 模块，统一处理主机端和客户端的同步逻辑",
    "新增：六种核心消息类型——ACTION_REQUEST、STATE_EVENT、EVENT_REQUEST、SNAPSHOT_REQUEST、SNAPSHOT、STATE_ACK",
    "重构：Host 端使用 commitGameState 统一提交游戏状态变化，每次状态变化产生递增 seq",
    "重构：Client 端使用 receiveStateEvent/processSyncQueue 按严格 seq 顺序应用状态事件",
    "重构：缺号检测使用 EVENT_REQUEST 请求指定范围事件，Host 从 eventLog 补发",
    "重构：完整状态恢复使用 SNAPSHOT/SNAPSHOT_REQUEST，与正常事件同步彻底分离",
    "重构：客户端加入/重连使用 SNAPSHOT 消息恢复，取代旧 WELCOME+CORE_MESSAGE 机制",
    "重构：客户端操作请求使用 ACTION_REQUEST，取代旧 GAME_ACTION+ACTION_RESULT 双消息",
    "重构：STATE_ACK 确认机制取代旧 SYNC_ACK+ACK retry 多层重试",
    "删除：旧的 CORE_MESSAGE、MISSING_MESSAGES_REQUEST、GAP_FILL、RESYNC、SYNC_STATUS、isSnapshot 绕过队列等机制",
    "删除：旧的 syncAll、emitCoreMessage、broadcastCoreMessage、enqueueCoreMessage、processMessageQueue 等函数",
    "优化：eventLog 保存最近 500 个事件，支持增量补发；无法补发时自动发送完整快照"
  ]},
  { version: "v1.2.4", items: [
    "修复：sendCoreMessageToPlayer 未转发 isSnapshot 标记，导致客户端 isSnapshot 绕过队列为死代码",
    "修复：handleMissingMessagesRequest 补发消息未转发 isSnapshot 标记",
    "修复：scheduleStateCheck 仅在 game 非空时运行，客户端漏收游戏开始 CORE_MESSAGE 后无法发起 SYNC_REQUEST，导致卡在lobby",
    "优化：客户端连接后始终每5秒发送 SYNC_REQUEST，房主检测到序列落后时自动发送 RESYNC 全量状态"
  ]},
  { version: "v1.2.3", items: [
    "修复：全量状态同步消息因队列阻塞无法及时应用——emitCoreMessage 为 SYNC 且无 draw 的消息添加 isSnapshot 标记，enqueueCoreMessage 检测到 isSnapshot 后立即应用状态并清空队列，不再入队等待"
  ]},
  { version: "v1.2.2", items: [
    "同步：房主也通过消息队列追踪自己的操作（executedSeqNum/executedMsgIds），保证所有玩家执行路径一致，房主转移后队列状态正确",
    "同步：增强 ACK 机制——未收到 ACK 超时后立即强制发送全量状态快照（RESYNC），不再等待 2 秒延迟重连",
    "同步：RESYNC/GAP_FILL 全量状态消息绕过消息队列直接应用，避免触发 gap-fill 等待导致 UI 卡死",
    "同步：状态快照存储完整游戏上下文（pendingEvent、角色冷却 disabledTurns/permanentlyDisabled、counters、lastActionAt 等全部字段），最多保留 5 份",
    "同步：handleMissingMessagesRequest 始终发送 GAP_FILL 全量状态，确保补发失败时客户端可恢复",
    "同步：gap-fill 超时后若队列为空（补发失败），自动发送 SYNC_REQUEST 请求全量同步"
  ]},
  { version: "v1.2.1", items: [
    "修复：加入房间稳定失败——WELCOME 处理时先保存队列中 seqNum 大于快照的消息，clearMessageQueue 后重新入队，避免早期 CORE_MESSAGE 被清空导致序列号断裂、UI 卡死",
    "修复：publicGameFor 请求者强制 connected=true，防止断线重连玩家（含 AI 托管）因 connected=false 被客户端误判为观战者而无法操作",
    "优化：连接超时延长——waitForConnectionOpen 16s→25s，joinRoom 房间无响应 12s→30s，超时提示优化为「连接房主超时，请确认房间码正确、房主在线，并检查网络后重试」"
  ]},
  { version: "v1.2.0", items: [
    "网络：重构通信层，引入核心消息同步机制（Core Message Sync）——所有游戏逻辑操作通过房主生成核心消息并广播，客户端不得自行执行状态逻辑",
    "网络：客户端实现消息队列，按全局序列号（seqNum）顺序执行，支持跳号检测与补发请求（MISSING_MESSAGES_REQUEST）",
    "网络：房主定期生成状态快照（每5回合或30秒），用于重连校验与状态恢复",
    "网络：所有卡牌效果、回合切换、事件触发均改为基于核心消息驱动，每条消息包含 msgId/seqNum/senderId/action/timestamp 等元数据",
    "网络：WELCOME 消息附带最近50条核心消息历史，支持重连后增量补齐",
    "网络：消息去重机制（msgId 滑动窗口，最多100条），防止网络重发导致重复执行",
    "网络：gap-fill 超时保护（3秒），超时后按全量状态消息直接应用，保证玩法正确性"
  ]},
  { version: "v1.1.0", items: [
    "角色：加拿大鹅稀有度由B+上调为A（4点）；实装被动 aura——场上存在其他玩家的加拿大鹅时，该玩家地道东京爷的配置水平提升量减半（减半效果不触发东京爷的免疫减少被动）",
    "角色：福瑞王 lore 更新为「（介绍待补充）」；修正角色卡图标缺失（238、柳橙汁3743）",
    "事件：新增2张稀有事件牌【电脑被没收了】（创新+5并跳过下一回合）、【谱面找不到了】（条件触发弃置所有手牌）；稀有事件牌权重为普通事件牌的 1/5",
    "抽卡：实装技能牌稀有度加权抽卡——白50%/绿25%/蓝15%/紫7%/橙2.9%/彩0.1%（与卡牌（新）.txt 概率分布一致）；手牌 UI 显示稀有度边框与分类标签",
    "技能：新增29张易实现的技能牌（含学习/发力/请教/只会这个/燃尽了/x x xxx/后起之秀/Rizline？！/刷刷B站/唐氏选曲/发散思维/别样的碰碰车大战/写合作谱/观望/开始写谱了/城市英雄/金叶的新人指导/写完了/简洁逼/取经/我要看城尾鱼上厕所/[图片]/出门录管乐/我拆线/双面下落/强迫式写谱/SV/老资历我给您桂霞了/全体目光向我看齐/神谱。/网报/要来不及了！/&./BPM轰炸/随机数写谱/工字钢/私人采样/魔王降临/暴风雨/跟你爆了！！！/塔之诅咒/一成不变/我就不写谱/调所有人事件/混沌/杂技/Remap/潦草急就），合计4+29=33张技能牌；含退坑角色点数倍率自动适配、招安角色 recruited 标记等机制",
    "维护：初始声望由 0 调整为 50（卡牌原文「同时获得初始【声望】50点」）",
    "维护：本地东京爷 aura 逻辑修正——只对场上其他玩家的加拿大鹅生效，自己同时持有加拿大鹅+东京爷时不再减半自己",
    "已知未实装：成为评委事件牌（需配合评谱卡）、α/达摩克利斯/反乌托邦/乌托邦序曲/斯卡雷特警察/窝瓜/憋大的！/组建谱面team/烫手山芋/你给我过来/时间扭曲/忘保存了/独占/小号哥/我是复制粘贴大王/随机填充/执迷-超脱互换/趣味生煎/沉默是金/憋气/预制事件/生产制造/沉淀/反乌托邦/已关闭评论区/抢你设备用一下/一场有组织有预谋的攻击/金叶的经验/金叶的金叶/星/乌托邦序曲/代币系统（帅/吊/星）/神谱。隐藏数值 等复杂技能牌待后续迭代"
  ]},
  { version: "v1.0.3", items: [
    "修复：AI 托管玩家的技能牌 / 角色技能 / 评议按钮在前端未禁用，导致点击后始终被服务端拒绝、显示“自己的回合使用”却无法使用的问题",
    "修复：PLAY_CARD 动作缺少“只能在自己的回合”校验，与其他动作保持一致",
    "修复：打中二 / 打舞萌 / 打音击事件选择角色时，技能被暂时禁用或永久失效的角色无法参与选择；现在所有角色（无论是否禁用）都可被选中并显示禁用状态标签",
    "新增：在自己回合的角色区域，若存在被禁用的角色，新增“被禁用的角色”分栏与「花 10 声望恢复被禁用角色」按钮；点击后可花费 10 点声望立即清除一个角色的永久失效 / 禁用回合状态"
  ]},
  { version: "v1.0.2", items: [
    "完善房间系统：localStorage 自动重连、心跳ACK重试、断线/重连消息、手动房主转让、断线90秒AI永久托管、120秒无操作AI永久接管",
    "新增聊天系统：房间频道、快捷短语、系统消息、房主禁言、敏感词过滤、玩家屏蔽",
    "更新日志按版本分组显示"
  ]},
  { version: "v1.0.1", items: [
    "新增12张事件牌并重做原有3张事件牌",
    "新增简单与普通难度机器人",
    "新增随时转让房主与随机玩家顺序",
    "首轮使用的角色决定谱面全部五维初始分数",
    "完善联机同步、额外回合与特殊顺序规则"
  ]}
]);

const ROOM_STATE = Object.freeze({
  WAITING: "WAITING",
  PLAYING: "PLAYING",
  SETTLEMENT: "SETTLEMENT"
});
const GAME_PHASE = Object.freeze({ DRAFT: "DRAFT", TURN: "TURN", SETTLEMENT: "SETTLEMENT" });
const DIMENSIONS = ["selection", "config", "abstract", "concrete", "innovation"];
const CHANGEABLE_DIMENSIONS = DIMENSIONS.filter(dimension => dimension !== "selection");
const CHARACTER_STATS = ["config", "abstract", "concrete", "innovation", "selection", "stamina"];
const DIMENSION_LABELS = Object.freeze({
  selection: "选曲品味",
  config: "配置水平",
  abstract: "抽象动效",
  concrete: "具象动效",
  innovation: "创新程度"
});
const CHARACTER_STAT_LABELS = Object.freeze({
  config: "配置能力",
  abstract: "抽象表演",
  concrete: "具象表演",
  innovation: "创新能力",
  selection: "选曲品味",
  stamina: "爆肝程度"
});
const SCORE_WEIGHTS = Object.freeze({
  selection: .05,
  config: .4,
  abstract: .2,
  concrete: .2,
  innovation: .15
});
const RARITY = Object.freeze({
  S: { label: "S", price: 6 },
  "A+": { label: "A+", price: 5 },
  A: { label: "A", price: 4 },
  "B+": { label: "B+", price: 3 },
  B: { label: "B", price: 2 },
  C: { label: "C", price: 1 }
});
// 技能牌稀有度：白50% / 绿25% / 蓝15% / 紫7% / 橙2.9% / 彩0.1%
const SKILL_RARITY = Object.freeze({
  white:   { label: "白", weight: 50 },
  green:   { label: "绿", weight: 25 },
  blue:    { label: "蓝", weight: 15 },
  purple:  { label: "紫", weight: 7 },
  orange:  { label: "橙", weight: 2.9 },
  rainbow: { label: "彩", weight: 0.1 }
});

const CHARACTERS = Object.freeze([
  {
    id: "ftayo", name: "Ftayo", rarity: "S", glyph: "crown",
    stats: { config: 8, abstract: 10, concrete: 10, innovation: 10, selection: 10, stamina: 11 },
    lore: "随着Bigsong的发布，Ftayo已经Ascension to Heaven，成为当之无愧的六边形战神。不俗的配置水平，恐怖的动效成熟度与……",
    abilities: [{
      id: "ftayo-main", cooldown: 5, choice: "two-dimensions", maxUses: 3,
      description: "每5回合可以发动1次，选择自己谱面中的任意2个维度提升至全场最高的数值。最多发动3次，且只能在回合数不超过总回合数70%时发动。"
    }],
    passive: "任何时候若某项维度的数值大于所有其他玩家的该项维度，则使随机一名对手随机维度值-2（每回合限一次）；每次维度值被某个对手超过时，抽1张牌。"
  },
  {
    id: "summercube", name: "Summercube", rarity: "A+", glyph: "boxes",
    stats: { config: 5, abstract: 9, concrete: 11, innovation: 8, selection: 8, stamina: 10 },
    lore: "不停地鹿！Summercube发动奇思妙想，让🦌进入了欧面，打破了单调无趣的演出后面忘了。",
    abilities: [{
      id: "summercube-main", cooldown: 3,
      description: "每3回合可以发动1次，将1点配置水平兑换为10点具象动效水平。"
    }],
    passive: "动效水平无提升上限。每提高15点动效水平，配置水平提升3点。"
  },
  {
    id: "sulfur", name: "SulfurDXD", rarity: "A+", glyph: "split",
    stats: { config: 7, abstract: 10, concrete: 10, innovation: 8, selection: 6, stamina: 10 },
    lore: "救救我艾琳啊啊啊啊啊啊啊",
    abilities: [{
      id: "sulfur-main", cooldown: 3, choice: "motion-distribution",
      description: "每3回合可以发动1次，将10个点数自行分配到具象动效水平或抽象动效水平。"
    }],
    passive: "动效水平的综合分换算占比+15%。"
  },
  {
    id: "jinye", name: "金叶", rarity: "A", glyph: "sparkles",
    stats: { config: 7, abstract: 9, concrete: 7, innovation: 6, selection: 6, stamina: 8 },
    lore: "你写的谱好",
    abilities: [{
      id: "jinye-main", cooldown: 2,
      description: "每2回合可以发动1次，将抽象动效水平提升5点；有20%概率触发Testify AT17，此时抽象动效水平降低2点。"
    }],
    passive: "每轮限两次，场上有玩家的能力值降低时，抽1张牌。"
  },
  {
    id: "ruishi", name: "瑞矢级别大", rarity: "A", glyph: "arrow-up-wide-narrow",
    stats: { config: 10, abstract: 9, concrete: 5, innovation: 5, selection: 8, stamina: 8 },
    lore: "温暖的小窝",
    abilities: [{
      id: "ruishi-main", cooldown: 2,
      description: "每2回合可以发动1次，将抽象表演水平与配置水平提升至自己谱面中点数最高的一项；与樱桃喝酒人同时获得时，每次发动技能可额外为每个维度增加1点。"
    }],
    passive: "自身使其他玩家维度值增长时，声望+1。"
  },
  {
    id: "cherry", name: "樱桃喝酒人", rarity: "A", glyph: "wine",
    stats: { config: 10, abstract: 9, concrete: 5, innovation: 5, selection: 8, stamina: 8 },
    lore: "国际玩笑掌握者",
    abilities: [{
      id: "cherry-main", cooldown: 2,
      description: "每2回合可以发动1次，将抽象表演水平与配置水平提升2点；与瑞矢级别大同时获得时，每次发动技能可额外为每个维度增加1点。"
    }],
    passive: "不受到任何事件牌效果影响，不会抽到事件牌。"
  },
  {
    id: "naogui", name: "恼鬼", rarity: "A", glyph: "laugh",
    stats: { config: 10, abstract: 8, concrete: 4, innovation: 6, selection: 9, stamina: 7 },
    lore: "线上保持着高冷人设的搞笑男，WJC辛勤工作的staff之一",
    abilities: [{
      id: "naogui-main", cooldown: 2,
      description: "每2回合可以发动1次，使配置水平提升2点。"
    }],
    passive: "每轮次一次，自己的能力值提升时，抽1张牌。"
  },
  {
    id: "two-three-eight", name: "238", rarity: "A", glyph: "award",
    stats: { config: 8, abstract: 9, concrete: 7, innovation: 7, selection: 10, stamina: 6 },
    lore: "他创造了圈内第一名梗",
    abilities: [{
      id: "two-three-eight-main", cooldown: 3,
      description: "每3回合可以发动1次，使抽象表演水平提升5点；同时拥有Ftayo时，改为每2回合发动1次。"
    }],
    passive: "每回合5次，自己通过非打出的方式失去1张牌时，随机维度+3。"
  },
  {
    id: "tokyo", name: "地道东京爷", rarity: "A", glyph: "landmark",
    stats: { config: 10, abstract: 6, concrete: 4, innovation: 6, selection: 8, stamina: 6 },
    lore: "",
    abilities: [{
      id: "tokyo-main", cooldown: 3,
      description: "每3回合发动1次，使配置水平提升4点。"
    }],
    passive: "每当自己的配置能力试图被减少时，免疫该效果，并使效果来源的对手直到自己的下个回合开始时不能发动技能。"
  },
  {
    id: "furry", name: "福瑞王", rarity: "B+", glyph: "rabbit",
    stats: { config: 7, abstract: 7, concrete: 5, innovation: 8, selection: 6, stamina: 8 },
    lore: "（介绍待补充）",
    abilities: [{
      id: "furry-main", cooldown: 1,
      description: "每1回合有75%的概率额外抽取1张牌，否则触发“创新”：创新程度+3，其余点数-1。"
    }],
    passive: "创新能力增加时，抽1张牌。"
  },
  {
    id: "canada-goose", name: "加拿大鹅", rarity: "A", glyph: "feather",
    stats: { config: 7, abstract: 5, concrete: 4, innovation: 5, selection: 6, stamina: 5 },
    lore: "我操。",
    abilities: [
      {
        id: "canada-wjc", cooldown: 4,
        description: "每4回合可以发动1次WJC，使场上其他玩家的非加拿大鹅角色卡在下一回合无法发动技能。在这一轮次内，玩家的角色卡（除了加拿大鹅）均会变为纯黑色且顺序被打乱，其所有技能将被禁用。"
      },
      {
        id: "canada-shift", cooldown: 3, choice: "up-to-two-targets",
        description: "每3回合选择至多2名玩家，使其谱面随机维度-1，并使加拿大鹅的谱面随机维度+2。"
      }
    ],
    passive: "每当事件牌发动时，自己的随机1个维度+5。"
  },
  {
    id: "disinfectant", name: "消毒水", rarity: "B+", glyph: "flask-conical",
    stats: { config: 8, abstract: 8, concrete: 4, innovation: 7, selection: 7, stamina: 5 },
    lore: "我就是喜欢AT17",
    abilities: [{
      id: "disinfectant-main", cooldown: 2,
      description: "每2回合可以发动1次“魅惑”，使场上其他玩家随机[玩家人数-1]张卡牌下一回合无法发动技能。"
    }],
    passive: "每当自己累计提升10点能力值，抽2张牌。"
  },
  {
    id: "ziwei", name: "子微中", rarity: "B+", glyph: "flower-2",
    stats: { config: 7, abstract: 7, concrete: 4, innovation: 6, selection: 7, stamina: 7 },
    lore: "小芳好可爱",
    abilities: [{
      id: "ziwei-main", cooldown: 2,
      description: "每2回合可以发动1次，80%概率在随机维度上提升3点，20%概率触发“子微”，技能发动失败。"
    }],
    passive: "每回合内打出第三张牌时，抽1张牌。每条维度限一次，自己的维度成为全场最高时，抽2张牌，随机维度+5。"
  },
  {
    id: "chi-mahu", name: "吃马虎", rarity: "B", glyph: "repeat-2",
    stats: { config: 7, abstract: 6, concrete: 4, innovation: 8, selection: 6, stamina: 5 },
    lore: "醋比饺子多的边缘谱师，有着不俗的配置能力。被恼鬼拉黑了。",
    abilities: [{
      id: "chi-mahu-main", cooldown: 3, choice: "opponent",
      description: "每3回合可以发动1次技能，以2点声望为代价，指定1名玩家与你交换全部手牌。每次发动后下一次发动所需声望翻倍。"
    }],
    passive: "每名其他玩家的回合限一次，你的任意维度数值被改变时，你的声望+1。"
  },
  {
    id: "dagezi", name: "大鸽子喵喵喵", rarity: "C", glyph: "message-circle-more",
    stats: { config: 4, abstract: 4, concrete: 4, innovation: 4, selection: 4, stamina: 4 },
    lore: "简单的六维评分已经无法形容此人的伟大。",
    abilities: [{
      id: "dagezi-main", cooldown: 1,
      description: "每回合可以发动1次，使谱面选曲品味外的所有维度点数降至当前最低值，并获得1点声望。"
    }],
    passive: "最终结算时，自己的综合分每低于前一名3分，使随机1名对手的综合分-2。"
  },
  {
    id: "hotwind", name: "热风小西八", rarity: "C", glyph: "flame",
    stats: { config: 2, abstract: 5, concrete: 3, innovation: 4, selection: 5, stamina: 5 },
    lore: "我遭到了有组织有预谋的攻击。",
    abilities: [{
      id: "hotwind-main", cooldown: 1,
      description: "每回合可以发动1次，以1点声望为代价，使所有带有“评议”身份的玩家抽象动效水平-8。"
    }],
    passive: "每当配置水平累计提升5点，获得1点声望。"
  },
  {
    id: "jiaojian", name: "我是脚健我很脚健", rarity: "B", glyph: "dumbbell",
    stats: { config: 12, abstract: 3, concrete: 3, innovation: 3, selection: 7, stamina: 5 },
    lore: "若有人三分似你，我便心颤魂惊。元老级别的谱师，早期自制圈塞爆的代名词，隐退后他的名字仍然响彻各个群聊，一提到挨踢十七，脑海中便不自觉地浮现他的冰西瓜。",
    abilities: [{
      id: "jiaojian-main", cooldown: 1, choice: "discard-cards",
      description: "弃置至多3张技能牌并抽等量的牌。"
    }],
    passive: "直至你的第四个回合结束，配置水平不会被减少且受到的增加效果翻倍。"
  },
  {
    id: "liuzhizhi", name: "柳橙汁3743", rarity: "C", glyph: "glass-water",
    stats: { config: 1, abstract: 1, concrete: 1, innovation: 2, selection: 1, stamina: 16 },
    lore: "这个也是谱师吗",
    abilities: [{
      id: "liuzhizhi-main", cooldown: 2, choice: "opponent-card",
      description: "每2回合查看一名其他玩家的所有技能牌，从中选择一张白色/绿色技能牌变成自己的牌然后将其打出。"
    }],
    passive: "版权警告！声望增加时，使随机一名其他玩家谱面的随机一个维度分数-2。"
  },
  {
    id: "ziyang", name: "子阳", rarity: "A", glyph: "sun",
    stats: { config: 6, abstract: 11, concrete: 11, innovation: 11, selection: 8, stamina: 9 },
    lore: "（介绍待补充）",
    abilities: [{
      id: "ziyang-main", cooldown: 1,
      description: "每回合可发动1次，你每拥有2点创新能力，获得1点具象表演水平和1点抽象表演水平。"
    }],
    passive: "你的具象表演水平的提升值翻倍。"
  }
]);

const TARGET_MODE = Object.freeze({
  NONE: "NONE",
  PLAYER: "PLAYER",
  PLAYER_AND_DIMENSION: "PLAYER_AND_DIMENSION",
  OWN_DIMENSION: "OWN_DIMENSION",
  OWN_CHARACTER: "OWN_CHARACTER",
  OWN_AND_OPPONENT_CHARACTERS: "OWN_AND_OPPONENT_CHARACTERS",
  ANY_CHARACTER: "ANY_CHARACTER",
  OWN_CHARACTER_AND_DIMENSION: "OWN_CHARACTER_AND_DIMENSION",
  OWN_AVAILABLE_CHARACTER: "OWN_AVAILABLE_CHARACTER",
  SELF_CARD: "SELF_CARD"
});

const SKILL_CARDS = Object.freeze([
  // ===== 成长（Growth）=====
  { id: "study", name: "学习", rarity: "white", category: "growth", target: "self", glyph: "book-open",
    description: "你的谱面中随机一个维度+3。" },
  { id: "effort", name: "发力", rarity: "green", category: "growth", target: "self", glyph: "zap", targetMode: "OWN_CHARACTER_AND_DIMENSION",
    description: "选择你的一名谱师（角色牌），选择ta除选曲品味外的任一属性加到你的对应维度上。" },
  { id: "consult", name: "请教", rarity: "white", category: "growth", target: "opponent", glyph: "hand-helping",
    description: "选择一名玩家，你每个比他低的维度都获得+2。" },
  { id: "only-this", name: "只会这个", rarity: "white", category: "growth", target: "self", glyph: "arrow-up",
    description: "当前谱面维度最高值+3。" },
  { id: "burn-out", name: "燃尽了", rarity: "white", category: "growth", target: "self", glyph: "flame",
    description: "当前谱面所有维度点数+1；若你手中没有手牌，该技能再发动1次。" },
  { id: "x-xxx", name: "x x xxx", rarity: "white", category: "growth", target: "self", glyph: "music",
    description: "你听了一遍Xterfusion。你的选曲品味+8。" },
  { id: "latecomer", name: "后起之秀", rarity: "green", category: "growth", target: "self", glyph: "trending-up",
    description: "你目前的谱面总分每差最高分1个名次，使当前谱面所有维度点数+1。" },
  { id: "rizline", name: "Rizline？！", rarity: "green", category: "growth", target: "self", glyph: "wand-sparkles",
    description: "具象动效水平+10，有20%概率额外使抽象动效水平+5。" },
  { id: "bilibili", name: "刷刷B站", rarity: "white", category: "growth", target: "self", glyph: "tv",
    description: "你有30%的概率什么都没干，否则配置水平、具象动效水平+2。" },
  { id: "tang-selection", name: "唐氏选曲", rarity: "white", category: "growth", target: "self", glyph: "shuffle",
    description: "THIS IS TRUE MUSIC。你的选曲品味-2，随机获得1-5点声望。" },
  { id: "divergent", name: "发散思维", rarity: "white", category: "growth", target: "self", glyph: "lightbulb",
    description: "你的创新程度+8，具象表演水平-3。若计算后你的抽象表演水平>具象表演水平，抽象表演水平+3。" },
  { id: "bumper-cars", name: "别样的碰碰车大战", rarity: "white", category: "growth", target: "opponent", glyph: "car",
    description: "选择一名谱师，你的选曲品味变为与其相同，但你的其他谱面维度-1。" },
  { id: "co-chart", name: "写合作谱", rarity: "white", category: "growth", target: "self", glyph: "users", targetMode: "ANY_CHARACTER",
    description: "选择场上任意一个可发动技能的角色，你的一项谱面维度+5，该项为你所指定的角色的数值最高的谱面维度（选曲品味除外）。选择过程类似「塔之诅咒」。" },
  { id: "observe", name: "观望", rarity: "white", category: "growth", target: "self", glyph: "eye",
    description: "你的选曲品味之外的谱面维度+1。" },
  { id: "start-chart", name: "开始写谱了", rarity: "white", category: "growth", target: "self", glyph: "pen-tool",
    description: "你的配置水平、具象动效水平、抽象动效水平、创新程度+1。" },
  { id: "city-hero", name: "城市英雄", rarity: "white", category: "growth", target: "self", glyph: "heart",
    description: "令除自己之外的其他玩家4项谱面维度+1，你的声望+3。" },
  { id: "jinye-mentor", name: "金叶的新人指导", rarity: "white", category: "growth", target: "self", glyph: "graduation-cap",
    description: "具象动效水平、抽象动效水平+1；若自己拥有金叶谱师卡牌，创新程度额外+2。" },
  { id: "finish-chart", name: "写完了", rarity: "blue", category: "growth", target: "self", glyph: "check-circle",
    description: "根据你的抽象动效水平，每3点会加1点配置水平。" },
  { id: "concise", name: "简洁逼", rarity: "white", category: "growth", target: "self", glyph: "scissors",
    description: "你令自己的具象动效水平-3，并令配置水平+4。" },
  { id: "learn-from", name: "取经", rarity: "white", category: "growth", target: "self", glyph: "book",
    description: "你加入了新的音游企划！创新程度+4。" },
  { id: "watch-toilet", name: "我要看城尾鱼上厕所", rarity: "blue", category: "growth", target: "self", glyph: "message-square",
    description: "场上若没有玩家拥有被招安的谱师，则你的声望-3；场上若有玩家拥有被招安的谱师，则你的声望+3。" },
  { id: "image", name: "[图片]", rarity: "blue", category: "growth", target: "self", glyph: "image",
    description: "发色图来增加群友好感度吧！声望+2。" },
  { id: "record", name: "出门录管乐", rarity: "white", category: "growth", target: "self", glyph: "mic",
    description: "师承木子荣浩的音乐审美。选曲品味+7。" },
  { id: "unthread", name: "我拆线", rarity: "green", category: "growth", target: "self", glyph: "unlink",
    description: "将你谱面的具象动效水平调整至与抽象动效水平一致。" },
  { id: "double-fall", name: "双面下落", rarity: "green", category: "growth", target: "self", glyph: "chevrons-down",
    description: "配置水平+4，若当前配置水平高于20，则额外+4。" },
  { id: "forced-chart", name: "强迫式写谱", rarity: "blue", category: "growth", target: "self", glyph: "refresh-cw",
    description: "自己的随机一项数值-1并摸两张牌。" },
  { id: "sv", name: "SV", rarity: "blue", category: "growth", target: "self", glyph: "activity",
    description: "声望+1。若你的配置水平大于你所有谱面维度的平均值，配置水平与抽象动效水平+5，反之则-5。" },
  { id: "seniority", name: "老资历我给您桂霞了", rarity: "purple", category: "growth", target: "self", glyph: "award",
    description: "使声望增加（配置水平+具象动效水平+抽象动效水平+创新程度数值的和除以10的余数）点。" },
  { id: "attention", name: "全体目光向我看齐！", rarity: "green", category: "growth", target: "self", glyph: "megaphone",
    description: "只有在声望大于40时可以打出。使创新程度+3，自己的声望与40相比每高出5点，额外+1。" },
  { id: "fge", name: "F鸽", rarity: "blue", category: "growth", target: "self", glyph: "panel-top",
    description: "你的谱面成为“故事板”谱面。在分数结算时，你的谱面获得五点分数加成。每名玩家仅能触发一次。" },
  // ===== 进攻（Attack）=====
  { id: "drink", name: "饮水", rarity: "purple", category: "attack", target: "opponent", glyph: "circle-off",
    description: "你可以指定一名成员使他的zpq崩溃，他在下一回合不可发动技能。" },
  { id: "god-chart-attack", name: "神谱。", rarity: "white", category: "attack", target: "opponent", glyph: "sparkle",
    description: "对任意一名对手的任意一个谱面维度使用，随机使该属性-8~+2。" },
  { id: "report", name: "网报", rarity: "blue", category: "attack", target: "opponent", glyph: "flag",
    description: "有80%概率该玩家的所有角色牌1回合内无法发动技能，且对方扣除10点声望；否则你被发现，你随机1个角色牌将永远无法发动技能，且自己扣除20点声望。" },
  { id: "no-time", name: "要来不及了！", rarity: "green", category: "attack", target: "opponent", glyph: "alarm-clock",
    description: "剩余轮数<4时方可打出。使一名其他玩家谱面的配置水平与具象表演水平各-5。" },
  { id: "amp", name: "&.", rarity: "blue", category: "attack", target: "opponent", glyph: "quote",
    description: "指定某一对象，使其声望-2。特别的，如果对象的角色为Ftayo/金叶/瑞矢级别大，声望额外-1；如果对象的角色为子微中，声望不受影响。" },
  { id: "bpm-bomb", name: "BPM轰炸", rarity: "purple", category: "attack", target: "opponent", glyph: "gauge",
    description: "选择一名玩家，将他的配置水平调整为当前平均值。" },
  { id: "random-chart", name: "随机数写谱", rarity: "white", category: "attack", target: "opponent", glyph: "dices", targetMode: "PLAYER",
    description: "将任意一名玩家的所有谱面维度数值重新随机调整为其另一维度的数值。" },
  { id: "ibeam", name: "工字钢", rarity: "white", category: "attack", target: "opponent", glyph: "minus",
    description: "你的声望-3，该玩家配置水平-12。" },
  { id: "private-sample", name: "私人采样", rarity: "white", category: "attack", target: "self", glyph: "file-audio",
    description: "你的选曲品味-3，所有其他玩家创新程度-3。" },
  { id: "devil-arrival", name: "魔王降临", rarity: "white", category: "attack", target: "self", glyph: "skull",
    description: "令除自己之外的其他玩家4项谱面维度-3，你的声望-1。" },
  { id: "storm", name: "暴风雨", rarity: "blue", category: "attack", target: "opponent", glyph: "cloud-rain",
    description: "选择一名玩家，被选择的玩家随机维度失去1分，此效果总共触发N次。N=你拥有的手牌数量（包含打出的这张牌）。" },
  { id: "burst", name: "跟你爆了！！！", rarity: "purple", category: "attack", target: "opponent", glyph: "bomb",
    description: "选择一名声望至少高出你8的玩家，使其声望-4，自己的创新程度+4。" },
  { id: "tower-curse", name: "塔之诅咒", rarity: "blue", category: "attack", target: "self", glyph: "lock", targetMode: "OWN_AND_OPPONENT_CHARACTERS",
    description: "东尼意思。打出后可选择自身1张角色卡以及其他玩家2~3张角色卡，在下一回合中禁用这些角色的技能（冷却技能照常充能）。" },
  // ===== 技能（Skill）=====
  { id: "review", name: "评议", rarity: "orange", category: "skill", target: "self", glyph: "tickets",
    description: "你成为评议3回合，该效果不可叠加，仅能刷新持续时间。每一回合你可指定1名玩家送出绿票/红票。若送出红票，该玩家的谱面配置水平提高10点，但连续2回合不可发动角色技能，同时你的声望-1。若送出绿票，该玩家声望+1，你的声望+2并抽取1张牌。累计给拥有热风小西八或大鸽子喵喵喵的玩家发放两次红票时，其自动获得一张【跟你爆了！！！】。" },
  { id: "commission", name: "约稿", rarity: "white", category: "skill", target: "self", glyph: "file-signature",
    description: "你的谱面成为约稿。你的谱面选曲点数变为场内所有选曲点数的平均数，你额外获得1张技能牌。但你的谱面点数在[剩余回合数*0.7]回合后锁定，不再发生任何变化。" },
  { id: "one-unchanged", name: "一成不变", rarity: "green", category: "skill", target: "self", glyph: "rotate-ccw", targetMode: "OWN_CHARACTER",
    description: "选择一个角色卡，将其技能切换为可用状态（不包括永久禁用角色）。" },
  { id: "refuse-chart", name: "我就不写谱", rarity: "green", category: "skill", target: "self", glyph: "ban", targetMode: "OWN_AVAILABLE_CHARACTER",
    description: "选择一个有可用的技能的角色卡，将其技能切换为不可用状态，抽2张牌。" },
  { id: "tune-event", name: "调所有人事件", rarity: "blue", category: "skill", target: "self", glyph: "sliders",
    description: "Out Elastic。所有玩家的某一同样（选曲品味除外）的谱面维度数值变为24。随机选择一个维度。" },
  { id: "chaos", name: "混沌", rarity: "purple", category: "skill", target: "self", glyph: "shuffle",
    description: "难道说……难道说！打出抽牌堆顶的3张牌。" },
  { id: "acrobatics", name: "杂技", rarity: "blue", category: "skill", target: "self", glyph: "circle-dot", targetMode: "SELF_CARD",
    description: "抽3张牌，丢弃1张牌。" },
  // ===== 抽牌（Draw）=====
  { id: "remap", name: "Remap", rarity: "green", category: "draw", target: "self", glyph: "repeat", targetMode: "NONE",
    description: "丢弃所有手牌，然后抽等于被丢弃的牌数量+1（数量计入打出的这张Remap）的牌。" },
  { id: "hasty-draft", name: "潦草急就", rarity: "purple", category: "draw", target: "self", glyph: "zap-off",
    description: "你的配置水平、抽象演出水平与具象演出水平各-3，抽5张牌。" },
  { id: "beibei", name: "贝贝", rarity: "white", category: "growth", target: "self", glyph: "skip-forward",
    description: "打出此牌后直接跳过本回合。由于节省了精力，你的创新程度+8。若此牌在【x x xxx】后一张打出，则获得“节目效果”，直到你的下一回合开始前，你的分数不会被减少。" },
  { id: "dcc", name: "我提交了二十张DCC", rarity: "purple", category: "skill", target: "self", glyph: "file-text",
    description: "你的声望+1。接下来的3轮内，其他玩家对你使用技能牌时需声望大于你。" },
  { id: "kkp", name: "kkp", rarity: "purple", category: "attack", target: "opponent", glyph: "eye",
    description: "叫一名玩家帮你看看谱，你的配置水平+4，该玩家跳过下一轮次内自己的回合，并且他的配置水平+2。" },
  { id: "comment-off", name: "已关闭评论区", rarity: "blue", category: "skill", target: "self", glyph: "ban",
    description: "你的声望-5。接下来的三个轮次内，其他玩家无法对你使用任何负面技能；你的所有谱面维度将被锁定，直至下一轮次内你自己的回合结束。" },
  { id: "star-hit", name: "撞星", rarity: "blue", category: "growth", target: "self", glyph: "star",
    description: "打出此牌后，你位置右方的所有手牌替换成【星】。根据替换手牌的卡色：每含一张橙色，具象+8且再摸一张撞星；每含一张紫色或蓝色，具象+8；每含一张绿色或白色，配置+5。若你的谱师牌包含Ftayo/238/恼鬼/子阳，此牌所有加分效果额外+4。" },
  { id: "limen", name: "里门", rarity: "green", category: "skill", target: "self", glyph: "door-open",
    description: "抽象动效水平与具象动效水平均+6。下一回合你进入静默状态：不可发动角色技能，仅可打出一张手牌，使此手牌对其他玩家的减分效果×3。若你的谱师牌包含子阳，减分效果×3改为×6。" }
]);

const EVENT_CARDS = Object.freeze([
  {
    id: "meeting", name: "面基", glyph: "users",
    description: "你的谱师们面基了！90%概率下，你的谱面所有维度+1；否则你的角色牌1回合无法发动技能。"
  },
  {
    id: "recruit", name: "招安", glyph: "badge-check",
    description: "六维评分总和最高的角色被招安：声望+15，但该角色此后无法发动任何技能；并列时按角色名字典序决定。"
  },
  {
    id: "retire", name: "退坑", glyph: "lock-keyhole",
    description: "一个随机角色退坑，技能永久禁用。此后技能牌造成的点数效果按退坑角色数提升倍率：1个×1.5、2个×2、3个×2.5，以此类推。"
  },
  {
    id: "new-draft", name: "新稿", glyph: "file-plus-2",
    description: "配置水平、抽象动效、具象动效、创新程度各+1；后两回合所有角色牌无法发动技能。"
  },
  {
    id: "inspiration", name: "灵光乍现！", glyph: "lightbulb",
    description: "你的一个随机维度+8~15。"
  },
  {
    id: "god-chart", name: "神谱发布！", glyph: "sparkles",
    description: "所有玩家抽2张技能牌，不会触发事件牌。"
  },
  {
    id: "pecjam", name: "PecJam", glyph: "refresh-cw",
    description: "下一轮开始时，所有角色牌技能恢复可用。"
  },
  {
    id: "maimai", name: "打舞萌", glyph: "disc-3",
    description: "选择另一位玩家，对方必须选择一名角色与你拼机，不可拒绝。完成后，两名玩家的配置水平+3，对方的角色下一回合无法使用其技能。"
  },
  {
    id: "chunithm", name: "打中二", glyph: "piano",
    description: "选择自己的1名角色和另一位玩家。对方同意时选择1名角色，双方配置与具象动效+5，且对方所选角色下一回合无法发动技能；拒绝时你的声望-5，配置与具象动效+5。"
  },
  {
    id: "ongeki", name: "打音击", glyph: "gamepad-2",
    description: "声望-1并选择自己的1名角色和另一位玩家。对方同意时选择1名角色，双方配置与具象动效+6，且对方所选角色下一回合无法发动技能；拒绝时你的声望再-5，配置与具象动效+6。"
  },
  {
    id: "mind-shock", name: "心灵震慑", glyph: "brain",
    description: "摸到后随机选择一名综合得分更高的玩家。若你至少有一个维度更高，你与对方最高分维度相同的维度+1；否则随机维度-1，且下一回合最多打出3张技能牌。没有更高分玩家时不产生效果。"
  },
  {
    id: "rpe", name: "崩所有人RPE", glyph: "monitor-up",
    description: "在场全部玩家的配置水平、抽象表演水平、具象表演水平中随机一项数值减半并向下取整（隐藏属性：若你的角色为PE谱师则无效）。"
  },
  {
    id: "clock-link", name: "时钟链接", glyph: "clock-3",
    description: "所有玩家在各自的下一个轮次获得一个额外回合。"
  },
  {
    id: "sun-tide", name: "凌日潮汐", glyph: "waves",
    description: "从当前玩家起按逆序行动至1号玩家；1号玩家完成回合后恢复正常顺序。"
  },
  {
    id: "tribunal", name: "众裁“区”", glyph: "gavel",
    description: "仅在玩家数不少于4时进入牌堆；当前谱面综合评分最低的2位玩家各失去8点声望。"
  },
  {
    id: "computer-removed", name: "电脑被没收了", glyph: "monitor-off", isRare: true,
    description: "【稀有牌】创新程度+5并跳过你的下一回合，下一回合结束时爆肝程度+2（拥有TPE谱师则无效果）。"
  },
  {
    id: "chart-missing", name: "谱面找不到了", glyph: "file-search", isRare: true,
    description: "【稀有牌】仅当你的≥2名角色爆肝程度≤7时可触发：弃置你的所有手牌。不满足条件时不产生效果。"
  }
]);

const ROOM_STORAGE_KEY = "puishi-card-last-room-v1";

const EVENT_LOG_MAX = 500;
const SYNC_GAP_TIMEOUT_MS = 3000;
// PeerJS "json" 序列化单条消息的保守安全阈值（约 16KB），超过即可能被 DataChannel 静默丢弃。
const PEER_SAFE_MESSAGE_BYTES = 16 * 1024;

const DISCONNECT_AI_TIMEOUT_MS = 90000;
const INACTIVE_AI_TIMEOUT_MS = 120000;

const CHAT_MAX_MESSAGES = 100;
const CHAT_RATE_LIMIT_MS = 3000;
const CHAT_MAX_LENGTH = 100;
const QUICK_PHRASES = ["你好", "等我一下", "好牌！", "GG", "厉害", "😅", "🔥", "🎵"];
const SENSITIVE_WORDS = ["操", "傻逼", "草泥马", "去死", "废物", "滚蛋", "智障", "脑残", "废物", "煞笔", "弱智", "狗日", "他妈", "你妈", " fuck", "shit", "bitch"];
const BLOCKED_PLAYER_KEY = "puishi-blocked-players";
