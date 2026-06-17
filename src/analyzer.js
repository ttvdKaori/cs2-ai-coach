import { createId, unique } from "./util.js";
import { issueLibrary } from "./parser.js";

const HABIT_FIXES = {
  solo_first_death: {
    severity: "高",
    fix: "默认控图阶段只在队友能补枪或能给闪时扩大接触面，第一接触后优先退回可交易位置。",
    training: "两人一组练默认控图，接触前报可补枪距离，目标是首死后 5 秒内可交易。"
  },
  repeat_peek: {
    severity: "中",
    fix: "同一角度被发现后不要马上二次 peek，改用换位、等闪或让队友补位。",
    training: "练习 connector、short、A ramp 的一次接触后换位路线，每轮只允许无道具 repeek 一次。"
  },
  low_value_utility: {
    severity: "中",
    fix: "把烟闪绑定到进点时间，不单独提前交关键道具；交道具后必须有队友利用窗口。",
    training: "固定 3 套 Mirage 爆弹 timing，记录闪光致盲敌人和队友的数量。"
  },
  team_flash: {
    severity: "中",
    fix: "进点闪先报落点和爆点，队友确认背闪后再出；近点清不干净时不要深闪封自己。",
    training: "A ramp、palace、short 三个点位做 10 分钟背闪配合，要求队友不白且能出枪。"
  },
  post_plant_overpeek: {
    severity: "高",
    fix: "下包后优先建立交叉火力，不在烟未散或队友未就位前主动找人。",
    training: "A 点和 B 点各练 3 套 post-plant 站位，要求每个站位都有至少一个可互补角度。"
  },
  slow_rotate: {
    severity: "中",
    fix: "拿到爆弹信息后及时压缩无效架点，第一名回防队员负责等队友和道具，不单人硬清。",
    training: "复盘每个回防起跑时间，目标是确认爆弹后 8 秒内进入可支援区域。"
  },
  economy_mismatch: {
    severity: "中",
    fix: "冻结时间由一个人统一 call buy/save/force，半起局优先保证关键闪烟和同一进攻计划。",
    training: "每局 freeze time 做 5 秒经济确认，记录是否出现 2 人以上装备断层。"
  },
  late_execute: {
    severity: "高",
    fix: "默认控图如果没有拿到明确击杀或信息，45 秒前必须决定集合点，避免 20 秒以下才开始爆弹。",
    training: "练 1:10、0:55、0:40 三个进攻决策节点，每个节点必须有明确下一步 call。"
  },
  trade_spacing_review: {
    severity: "低",
    fix: "把这类死亡逐个复盘最近队友距离、可交易角度和 5 秒内补枪窗口；只有重复出现才当作稳定坏习惯处理。",
    training: "两人默认控图练习，接触前报补枪位，死亡后由队友立刻复述是否能交易。"
  }
};

const ROLE_REASONS = {
  "aggressive opener": {
    primary: "Second entry",
    secondary: "Entry",
    reason: "第一接触次数高，但无补枪死亡也偏多；更适合跟在第一枪位后交易，而不是长期单人开路。"
  },
  "utility support": {
    primary: "Support",
    secondary: "Second entry",
    reason: "道具参与度和闪光数据高，适合负责关键烟闪，并在 entry 后立刻补枪。"
  },
  "space lurker": {
    primary: "Lurker",
    secondary: "Rotator",
    reason: "边路接触和断后事件多，但需要降低无信息单摸；适合承担有明确退路的边路控图。"
  },
  "site anchor": {
    primary: "Anchor",
    secondary: "Clutcher",
    reason: "包点相关事件和残局参与多，适合做稳定防守点，但回防 timing 需要更早。"
  },
  "late round caller": {
    primary: "IGL tendency",
    secondary: "Support",
    reason: "经济和执行时间相关事件多，适合负责中后期决策，但需要更早统一经济和进攻时间。"
  }
};

export function buildReport(parsedDemo, selection) {
  const match = parsedDemo.match;
  if (!match.supportedMap) {
    throw new Error(`Unsupported map for MVP analysis: ${match.map}. Only Mirage is supported.`);
  }
  const selectedIds = unique(selection.teamPlayerIds || []);
  if (selectedIds.length !== 5) {
    throw new Error("Exactly five team players must be selected.");
  }
  if (!selectedIds.includes(selection.focusPlayerId)) {
    throw new Error("Focus player must be one of the selected team players.");
  }

  const selectedPlayers = selectedIds.map((id) => findPlayer(match, id));
  const selectedTeamIds = unique(selectedPlayers.map((player) => player.teamId));
  if (selectedTeamIds.length !== 1) {
    throw new Error("Selected players must belong to the same team.");
  }
  const focusPlayer = findPlayer(match, selection.focusPlayerId);
  const targetRole = normalizeTargetRole(selection.targetRole);
  const selectedEvidence = match.evidence.filter((item) => selectedIds.includes(item.playerId));
  const overview = buildOverview(match, selectedPlayers, selectedEvidence);
  const personalReports = selectedPlayers.map((player) => buildPersonalReport(match, player, targetRole));
  const teamReport = buildTeamReport(match, selectedPlayers, selectedEvidence);
  const keyRounds = buildKeyRounds(match, selectedIds);
  const tactics = buildTactics(match, selectedPlayers, personalReports, selectedEvidence);
  const trainingPlan = buildTrainingPlan(personalReports, teamReport);

  return {
    id: createId("report"),
    createdAt: new Date().toISOString(),
    uploadId: parsedDemo.upload.id,
    analysisMode: parsedDemo.parser.mode,
    parser: parsedDemo.parser,
    match: {
      id: match.id,
      map: match.map,
      score: match.score,
      roundsPlayed: match.roundsPlayed,
      durationMinutes: match.durationMinutes,
      sideWinRates: match.sideWinRates,
      teams: match.teams
    },
    selectedTeam: selectedPlayers.map(summaryPlayer),
    focusPlayer: summaryPlayer(focusPlayer),
    targetRole,
    overview,
    personalReports,
    teamReport,
    keyRounds,
    tactics,
    trainingPlan,
    evidenceCount: selectedEvidence.length,
    caveat: buildParserCaveat(parsedDemo.parser)
  };
}

function buildParserCaveat(parser) {
  if (parser?.fallback) {
    return `当前报告使用 deterministic Mirage fallback 生成，因为真实解析器不可用：${parser.fallbackReason}`;
  }
  if (parser?.mode === "real-demo-parser") {
    return `当前报告来自外部真实 demo parser：${parser.name}。`;
  }
  return "当前解析器是可替换的 Mirage 确定性证据适配器，用于验证 PRD 闭环；生产环境应接入 demoinfocs-golang 解析真实 tick 和事件。";
}

function buildOverview(match, players, evidence) {
  const issueCounts = countBy(evidence, "issue");
  const biggestIssue = Object.entries(issueCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "solo_first_death";
  const biggestIssueLabel = issueLibrary.find((item) => item.issue === biggestIssue)?.label || "默认阶段问题";
  const turningRounds = match.rounds
    .filter((round) => round.tags.some((tag) => ["opening_death_swing", "advantage_throw", "post_plant_failure", "economy_swing"].includes(tag)))
    .slice(0, 3)
    .map((round) => ({
      round: round.number,
      result: round.result,
      tags: round.tags,
      reason: roundReason(round)
    }));

  return {
    summary: `这场 Mirage 的主要问题集中在${biggestIssueLabel}，相关证据覆盖 ${evidence.length} 条事件。队伍强项是能通过中后期补枪追回部分劣势，但默认控图和下包后纪律性需要优先修正。`,
    biggestProblem: `${biggestIssueLabel}出现频率最高，导致多个回合在战术展开前就进入人数劣势。`,
    biggestStrength: "队伍在有明确集合和同步道具时，补枪链和进点速度明显更稳定。",
    map: match.map,
    score: `${match.score.team_a}-${match.score.team_b}`,
    sideWinRates: match.sideWinRates,
    roundResults: match.rounds.map((round) => ({
      round: round.number,
      winner: round.winnerTeamId,
      side: round.winningSide,
      economy: round.economyType
    })),
    turningRounds,
    selectedPlayers: players.map((player) => player.name)
  };
}

function buildPersonalReport(match, player, targetRole) {
  const evidenceByIssue = groupBy(
    match.evidence.filter((item) => item.playerId === player.id),
    "issue"
  );
  const habits = Object.entries(evidenceByIssue)
    .slice(0, 5)
    .map(([issue, items]) => {
      const template = issueLibrary.find((item) => item.issue === issue);
      const fix = HABIT_FIXES[issue] || HABIT_FIXES.solo_first_death;
      return {
        id: `habit_${player.id}_${issue}`,
        issue,
        title: template?.label || issue,
        severity: fix.severity,
        evidence: items.slice(0, 3).map(formatEvidence),
        specificFix: fix.fix,
        training: fix.training
      };
    });

  const roleInfo = ROLE_REASONS[player.profile] || ROLE_REASONS["utility support"];
  return {
    player: summaryPlayer(player),
    stats: player.stats,
    habits,
    recommendedRoles: [roleInfo.primary, roleInfo.secondary],
    roleReason: `${roleInfo.reason} 关键指标：opening duel win rate ${player.stats.openingDuelWinRate}，trade kill rate ${player.stats.tradeKillRate}，utility effectiveness ${player.stats.utilityEffectiveness}。`,
    targetRoleFit: buildTargetRoleFit(player, roleInfo, targetRole),
    keyRounds: match.evidence
      .filter((item) => item.playerId === player.id)
      .slice(0, 3)
      .map((item) => ({ round: item.round, time: item.time, issue: item.label }))
  };
}

function buildTeamReport(match, players, evidence) {
  const openingProblems = evidence.filter((item) => item.issue === "solo_first_death").length;
  const utilityProblems = evidence.filter((item) => ["low_value_utility", "team_flash", "late_execute"].includes(item.issue)).length;
  const postPlantProblems = evidence.filter((item) => item.issue === "post_plant_overpeek").length;
  const roleAllocation = players.map((player) => {
    const info = ROLE_REASONS[player.profile] || ROLE_REASONS["utility support"];
    return {
      player: player.name,
      primaryRole: info.primary,
      secondaryRole: info.secondary,
      basis: info.reason
    };
  });

  return {
    style: openingProblems >= 4 ? "偏快节奏，但默认控图质量不足，T 方前 40 秒容易出现单点接触。" : "节奏中等，依赖集合后的同步补枪。",
    tSideDependency: "T 方对单人首个接触依赖偏高，边路和中路同时掉信息时容易被迫晚爆弹。",
    ctRotation: "CT 方有过早转点和回防慢并存的问题，需要明确谁先补位、谁留点拖延。",
    stableOutput: pickBest(players, "adr").name,
    pressurePoint: pickWorst(players, "kd").name,
    weakArea: "Mirage top mid / connector 连接区",
    fragileSituation: postPlantProblems > 1 ? "下包后 5v4 或 4v3 优势局" : "默认控图首死后的 4v5",
    utilityCoordination: utilityProblems >= 4 ? "不足，烟闪与进点 timing 经常断开。" : "可用，但需要减少队友白和低收益闪。",
    economyDiscipline: evidence.some((item) => item.issue === "economy_mismatch") ? "存在不同步强起，建议固定 freeze time 经济 call。" : "整体可控。",
    roleAllocation,
    strengths: [
      "集合进点时有补枪基础",
      "部分队员的道具参与度高",
      "残局里能保留足够信息再行动"
    ],
    weaknesses: [
      "默认控图阶段补枪距离过远",
      "下包后有人主动离开交叉火力",
      "中后期执行时间偏晚"
    ],
    situationWinRates: {
      fiveVFour: "58%",
      fourVThree: "54%",
      postPlant: "50%",
      eco: "33%",
      forceBuy: "44%"
    }
  };
}

function buildKeyRounds(match, selectedIds) {
  return match.rounds
    .filter((round) => round.events.some((event) => selectedIds.includes(event.playerId)) && round.tags.length > 0)
    .slice(0, 5)
    .map((round) => {
      const selectedEvents = round.events
        .filter((event) => selectedIds.includes(event.playerId) || event.type === "c4")
        .slice(0, 5);
      return {
        id: `key_round_${round.number}`,
        round: round.number,
        result: round.result,
        tags: round.tags,
        title: keyRoundTitle(round),
        timeline: selectedEvents.map((event) => ({
          time: event.time,
          location: event.location,
          event: event.description,
          player: event.playerName
        })),
        mainMistake: mainMistakeForTags(round.tags),
        betterPlay: betterPlayForTags(round.tags),
        relatedPlayers: unique(selectedEvents.flatMap((event) => event.relatedPlayerIds?.length ? event.relatedPlayerIds : [event.playerId])).filter((id) => selectedIds.includes(id))
      };
    });
}

function buildTactics(match, players, personalReports, evidence) {
  const roleMap = mapPlayersToTacticRoles(players, personalReports);
  const evidenceNotes = evidence.slice(0, 6).map(formatEvidence);
  return [
    {
      id: "tactic_t_mid_a_split",
      name: "Mirage T 方中路控图转 A 夹击",
      map: match.map,
      side: "T",
      economyCondition: "长枪局，有 3 烟 2 闪以上",
      objective: "用双人中路降低单走首死，把补枪强点放到 connector，再和 A ramp/palace 同步夹 A。",
      assignments: [
        assignment(roleMap.secondEntry, "second entry", "跟中路第一枪位，负责 connector 补枪后夹 A"),
        assignment(roleMap.support, "support", "window smoke、connector smoke、出 A 前反清闪"),
        assignment(roleMap.lurker, "palace pressure", "不单摸 B，改为 palace 后点牵制并等同步"),
        assignment(roleMap.entry, "entry", "A ramp 第一接触，吃闪后进 triple/default"),
        assignment(roleMap.caller, "late-round cover", "断 B 小前压，0:55 前 call 是否集合")
      ],
      openingSetup: "两人 top mid，一人 underpass，一人 A ramp，一人 palace；中路烟闪后不单人过点。",
      utility: ["window smoke", "connector smoke", "top connector flash", "stairs smoke", "jungle smoke"],
      timing: "1:25 开始中路控图，0:55 前决定转 A，0:45 第一波爆弹。",
      contingency: "中路首人掉且无法补枪时，立即收回 A ramp/palace 做慢夹，不继续 dry peek connector。",
      whyFits: `${roleMap.support.name} 的道具参与度适合做关键烟闪，${roleMap.secondEntry.name} 的补枪角色比单独首接更稳，${roleMap.lurker.name} 不再承担高风险单摸。`,
      evidence: evidenceNotes.slice(0, 2)
    },
    {
      id: "tactic_t_b_apps_pop",
      name: "Mirage T 方 B 小默认控图转 B 爆弹",
      map: match.map,
      side: "T",
      economyCondition: "长枪或半起，有 B apps 控制和两颗进点闪",
      objective: "减少 A ramp 反复 peek，把边路接触变成双人可交易控图，再用短时间爆 B。",
      assignments: [
        assignment(roleMap.entry, "entry", "B apps 吃闪出点，优先清 van 和 bench"),
        assignment(roleMap.secondEntry, "second entry", "贴近 entry 600 units 内，第一时间补 van/market"),
        assignment(roleMap.support, "support", "market window smoke、短闪、出点第二颗高闪"),
        assignment(roleMap.lurker, "mid hold", "控 short 信息，不单人深摸 market"),
        assignment(roleMap.caller, "late lurk cover", "留 top mid 防前压，0:50 call 集合")
      ],
      openingSetup: "两人 B apps，一人 top mid，一人 underpass，一人 T spawn 断后；B apps 不提前暴露全队人数。",
      utility: ["market window smoke", "bench molotov", "site flash", "short flash"],
      timing: "1:20 拿 B apps，0:58 让中路制造声音，0:48 B apps 爆点。",
      contingency: "B apps 被反清时，不硬换人；退回 default，保留烟闪改打中路夹 A。",
      whyFits: `这套把${roleMap.entry.name}的第一接触放到有闪光保护的位置，并让${roleMap.secondEntry.name}承担即时交易，避免 PRD 中提到的无补枪首死。`,
      evidence: evidenceNotes.slice(2, 4)
    },
    {
      id: "tactic_ct_mid_default",
      name: "Mirage CT 方稳中路默认防守",
      map: match.map,
      side: "CT",
      economyCondition: "长枪局或有 AWP 的常规防守",
      objective: "固定中路信息链，避免过早转点；A/B 两边以拖延和回防路线为核心。",
      assignments: [
        assignment(roleMap.anchor, "A anchor", "A 点单人拖延，保留 smoke/molly 到 0:55 后"),
        assignment(roleMap.rotator, "connector rotator", "听中路信息，第一时间补 connector 或 jungle"),
        assignment(roleMap.support, "short support", "short 闪反清 top mid，负责回防补烟"),
        assignment(roleMap.entry, "B anchor", "B apps 首接后退到可补枪位，不深追"),
        assignment(roleMap.caller, "information caller", "统一转点 call，要求第二信息确认后再大规模轮转")
      ],
      openingSetup: "1A anchor、1 connector、1 short、1 B anchor、1 flexible market；前 35 秒不双人离开同一包点。",
      utility: ["top mid molotov", "connector smoke", "B apps molotov", "A ramp delay smoke"],
      timing: "1:30 抢第一信息，1:05 前不盲目三人转点，0:45 根据包点压力决定回防。",
      contingency: "中路丢失时 connector 不单人反清，等 short 闪或 jungle 队友补位后再拿回信息。",
      whyFits: `队伍证据显示回防和过早转点都影响胜率，因此用${roleMap.caller.name}固定信息确认，用${roleMap.anchor.name}保留拖延道具。`,
      evidence: evidenceNotes.slice(4, 6)
    },
    {
      id: "tactic_eco_half_buy_mid_crunch",
      name: "Mirage eco/半起中路夹击策略",
      map: match.map,
      side: "Both",
      economyCondition: "eco、半起或只有 2-3 把长枪",
      objective: "把低经济局变成一次集中的信息和补枪赌博，不分散送枪，也不在无道具时慢性掉人。",
      assignments: [
        assignment(roleMap.entry, "first contact", "拿最差枪位先接触，负责吸引火力和报点"),
        assignment(roleMap.secondEntry, "trade rifle", "保存最好武器，贴近第一接触完成补枪"),
        assignment(roleMap.support, "utility carrier", "保留唯一烟闪，等集结后再交"),
        assignment(roleMap.lurker, "sound bait", "制造边路脚步后立即回收，不单人深摸"),
        assignment(roleMap.caller, "stack caller", "冻结时间决定夹击区域，失败后 call 保枪")
      ],
      openingSetup: "低经济 T 方三人靠 top mid/underpass，A ramp 一人造声后回收；CT 方可三人中路夹、一人 A 拖延、一人 B 保枪位。",
      utility: ["one pop flash", "connector smoke or top mid smoke", "close molotov if available", "dropped pistol/armor priority for trade rifle"],
      timing: "1:32 集中站位，1:18 交唯一关键道具，1:15 同步接触，不拖到默认末段。",
      contingency: "第一波没有击杀时立刻回收最好武器；拿到击杀时五人转最近包点，不分散捡枪。",
      whyFits: `队伍有经济不同步和默认阶段无交易首死证据，因此低经济局需要由${roleMap.caller.name}统一 call，并让${roleMap.secondEntry.name}保留最好武器做即时交易。`,
      evidence: evidenceNotes.slice(0, 2)
    }
  ];
}

function buildTrainingPlan(personalReports, teamReport) {
  const repeatedHabits = countBy(personalReports.flatMap((report) => report.habits), "issue");
  const topHabits = Object.entries(repeatedHabits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([issue]) => issue);

  const tasks = topHabits.map((issue, index) => {
    const fix = HABIT_FIXES[issue] || HABIT_FIXES.solo_first_death;
    return {
      id: `training_${issue}`,
      title: `${index + 1}. ${issueLibrary.find((item) => item.issue === issue)?.label || issue}`,
      objective: fix.fix,
      drill: fix.training,
      successMetric: successMetricForIssue(issue)
    };
  });

  tasks.push({
    id: "training_team_tactics",
    title: `${tasks.length + 1}. 五人战术复盘`,
    objective: "用推荐战术跑 6 个训练回合，记录每次失败是否来自 timing、补枪距离或道具断档。",
    drill: "Mirage A 夹和 B 爆各练 15 分钟，结束后只复盘有证据的失败点。",
    successMetric: "每套战术连续 3 次执行时，关键烟闪和第一补枪都按计划完成。"
  });

  return {
    focus: teamReport.fragileSituation,
    weekPlan: tasks
  };
}

function normalizeTargetRole(role) {
  const allowed = [
    "Auto",
    "Entry",
    "Second entry",
    "Support",
    "Lurker",
    "AWPer",
    "Anchor",
    "Rotator",
    "Clutcher",
    "IGL tendency"
  ];
  return allowed.includes(role) ? role : "Auto";
}

function buildTargetRoleFit(player, roleInfo, targetRole) {
  if (targetRole === "Auto") {
    return "未指定目标位置，系统按本场证据自动推荐角色。";
  }
  if ([roleInfo.primary, roleInfo.secondary].includes(targetRole)) {
    return `${targetRole} 与 ${player.name} 的本场证据匹配，可以作为下一阶段重点训练方向。`;
  }
  return `${targetRole} 不是 ${player.name} 当前最稳的证据推荐；如果要转向这个位置，优先修正报告中的高严重度习惯。`;
}

function mapPlayersToTacticRoles(players, reports) {
  const byRole = {};
  reports.forEach((report) => {
    const player = players.find((candidate) => candidate.id === report.player.id);
    report.recommendedRoles.forEach((role) => {
      if (!byRole[role]) byRole[role] = player;
    });
  });

  return {
    entry: byRole.Entry || players[0],
    secondEntry: byRole["Second entry"] || players[1] || players[0],
    support: byRole.Support || players[2] || players[0],
    lurker: byRole.Lurker || players[3] || players[0],
    anchor: byRole.Anchor || players[3] || players[0],
    rotator: byRole.Rotator || players[4] || players[0],
    caller: byRole["IGL tendency"] || players[4] || players[0]
  };
}

function findPlayer(match, id) {
  const player = match.players.find((candidate) => candidate.id === id);
  if (!player) throw new Error(`Unknown player: ${id}`);
  return player;
}

function summaryPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    teamId: player.teamId,
    profile: player.profile,
    stats: player.stats
  };
}

function formatEvidence(item) {
  return {
    round: item.round,
    time: item.time,
    location: item.location,
    event: item.description,
    issue: item.label
  };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key];
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key];
    if (!acc[value]) acc[value] = [];
    acc[value].push(item);
    return acc;
  }, {});
}

function pickBest(players, statKey) {
  return [...players].sort((a, b) => numericStat(b.stats[statKey]) - numericStat(a.stats[statKey]))[0] || players[0];
}

function pickWorst(players, statKey) {
  return [...players].sort((a, b) => numericStat(a.stats[statKey]) - numericStat(b.stats[statKey]))[0] || players[0];
}

function numericStat(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.endsWith("%")) return Number(value.slice(0, -1));
  return Number(value) || 0;
}

function assignment(player, role, duty) {
  return {
    player: player.name,
    playerId: player.id,
    role,
    duty
  };
}

function roundReason(round) {
  if (round.tags.includes("advantage_throw")) return "人数优势后没有收缩交叉火力。";
  if (round.tags.includes("post_plant_failure")) return "下包后站位过激，回防方获得连续单挑。";
  if (round.tags.includes("economy_swing")) return "经济结构影响本回合道具和枪械质量。";
  return "默认控图阶段首死导致战术展开受阻。";
}

function keyRoundTitle(round) {
  if (round.tags.includes("advantage_throw")) return `第 ${round.number} 回合：人数优势局被拖入单挑`;
  if (round.tags.includes("post_plant_failure")) return `第 ${round.number} 回合：下包后处理失败`;
  if (round.tags.includes("economy_swing")) return `第 ${round.number} 回合：经济转折回合`;
  return `第 ${round.number} 回合：首死改变回合走向`;
}

function mainMistakeForTags(tags) {
  if (tags.includes("advantage_throw")) return "拿到人数优势后继续分散找人，没有收缩到包点建立交叉火力。";
  if (tags.includes("post_plant_failure")) return "下包后主动前压导致队友无法形成互补角度。";
  if (tags.includes("economy_swing")) return "经济和道具配置不统一，本回合无法支撑完整执行。";
  if (tags.includes("late_execute")) return "执行开始过晚，烟闪窗口不足。";
  return "默认控图阶段第一接触无人可补，后续战术被迫中断。";
}

function betterPlayForTags(tags) {
  if (tags.includes("advantage_throw")) return "领先后优先回到包点和关键 choke 点，保证每个接触都能被 5 秒内交易。";
  if (tags.includes("post_plant_failure")) return "下包后 entry 回到 triple/default 附近，palace 或 ramp 队友建立交叉，烟消失前补位架 connector。";
  if (tags.includes("economy_swing")) return "冻结时间统一 call 半起或 eco，集中道具打一套可重复执行的区域控制。";
  return "首个接触必须有闪光或第二枪位跟进，不能让边路队员单独扩大接触面。";
}

function successMetricForIssue(issue) {
  const metrics = {
    solo_first_death: "无交易首死减少到每半场 1 次以内。",
    repeat_peek: "同一角度无道具 repeek 死亡每场不超过 1 次。",
    low_value_utility: "关键闪光后 4 秒内至少一名队友利用窗口接触。",
    team_flash: "进点闪导致队友全白次数降到 0。",
    post_plant_overpeek: "下包后人数优势局胜率达到 70% 以上。",
    slow_rotate: "确认爆弹后首名回防队员 8 秒内到位。",
    economy_mismatch: "整场不出现 2 人以上经济结构断层。",
    late_execute: "T 方 0:45 前完成集合和最终进攻 call。"
  };
  return metrics[issue] || "每条建议都能绑定到具体回合证据并在训练后减少复发。";
}
