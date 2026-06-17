import { clamp, formatRoundTime, mulberry32, percent, pick, seedFromHash } from "./util.js";

const BASE_NAMES = [
  "Viper",
  "Anchor",
  "Orbit",
  "Kite",
  "Mako",
  "Pulse",
  "Rook",
  "Nova",
  "Iris",
  "Tempo"
];

const LOCATIONS = [
  "top mid",
  "underpass",
  "A ramp",
  "palace",
  "connector",
  "jungle",
  "B apps",
  "short",
  "market",
  "CT spawn",
  "triple",
  "default"
];

const ISSUE_LIBRARY = [
  {
    issue: "solo_first_death",
    label: "默认阶段单走首死",
    locations: ["top mid", "underpass", "B apps"],
    event: "无补枪首死",
    text: (name, location) => `${name}在${location}单人接触被击杀，最近队友距离超过 1000 units，5 秒内没有补枪。`
  },
  {
    issue: "repeat_peek",
    label: "重复 peek 同一角度",
    locations: ["connector", "A ramp", "short"],
    event: "重复 peek",
    text: (name, location) => `${name}在${location}连续两次 peek 同一角度，第二次被预瞄击杀。`
  },
  {
    issue: "low_value_utility",
    label: "道具无收益",
    locations: ["top mid", "A execute", "B apps"],
    event: "低收益道具",
    text: (name, location) => `${name}在${location}交出关键闪光，但没有致盲敌人，也没有形成同步进点。`
  },
  {
    issue: "team_flash",
    label: "闪到队友",
    locations: ["A ramp", "palace", "short"],
    event: "闪到队友",
    text: (name, location) => `${name}在${location}闪光落点偏深，致盲两名队友，进点节奏被迫停顿。`
  },
  {
    issue: "post_plant_overpeek",
    label: "下包后站位过激",
    locations: ["triple", "CT spawn", "market"],
    event: "下包后前压死亡",
    text: (name, location) => `${name}下包后离开交叉火力，在${location}主动找人被击杀，人数优势消失。`
  },
  {
    issue: "slow_rotate",
    label: "回防过慢",
    locations: ["market", "CT spawn", "jungle"],
    event: "回防慢",
    text: (name, location) => `${name}在听到爆弹后仍停留在${location}架无接触角度，回防到位晚于队友 9 秒。`
  },
  {
    issue: "economy_mismatch",
    label: "经济决策不统一",
    locations: ["freeze time", "T spawn", "CT spawn"],
    event: "经济不同步",
    text: (name, location) => `${name}在${location}选择强起长枪，但两名队友为半起，导致本回合道具和枪械结构断层。`
  },
  {
    issue: "late_execute",
    label: "执行时间过晚",
    locations: ["A ramp", "top mid", "B apps"],
    event: "过晚爆弹",
    text: (name, location) => `${name}和队友在${location}等待过久，20 秒以下才开始爆弹，补烟时间不够。`
  },
  {
    issue: "trade_spacing_review",
    label: "可能无补枪距离",
    locations: ["top mid", "A ramp", "B apps", "connector"],
    event: "死亡后交易窗口待核对",
    text: (name, location) => `${name}在${location}死亡，需要核对最近队友距离和 5 秒内交易窗口。`
  }
];

const PROFILE_ISSUES = [
  ["solo_first_death", "repeat_peek", "post_plant_overpeek"],
  ["low_value_utility", "team_flash", "late_execute"],
  ["solo_first_death", "slow_rotate", "economy_mismatch"],
  ["slow_rotate", "repeat_peek", "post_plant_overpeek"],
  ["economy_mismatch", "late_execute", "low_value_utility"]
];

const PROFILE_LABELS = [
  "aggressive opener",
  "utility support",
  "space lurker",
  "site anchor",
  "late round caller"
];

export function parseDemo(upload) {
  if (!upload?.originalName?.toLowerCase().endsWith(".dem")) {
    throw new Error("Only .dem files are supported in the MVP upload path.");
  }

  const seed = seedFromHash(upload.sha256 || upload.id);
  const rand = mulberry32(seed);
  const players = buildPlayers(rand);
  const rounds = buildRounds(rand, players);
  const evidence = buildEvidence(rand, players, rounds);
  attachEvidenceToRounds(rounds, evidence);

  const score = rounds.reduce(
    (acc, round) => {
      acc[round.winnerTeamId] += 1;
      return acc;
    },
    { team_a: 0, team_b: 0 }
  );

  const playerStats = buildPlayerStats(rand, players, evidence);
  players.forEach((player) => {
    player.stats = playerStats[player.id];
  });

  return {
    parser: {
      name: "deterministic-mirage-adapter",
      mode: "synthetic-evidence",
      replaceWith: "demoinfocs-golang adapter for production .dem decoding"
    },
    upload: {
      id: upload.id,
      originalName: upload.originalName,
      size: upload.size,
      sha256: upload.sha256
    },
    match: {
      id: `match_${String(upload.sha256 || upload.id).slice(0, 12)}`,
      map: "Mirage",
      supportedMap: true,
      score,
      teams: [
        { id: "team_a", name: "Team A" },
        { id: "team_b", name: "Team B" }
      ],
      roundsPlayed: rounds.length,
      durationMinutes: 42 + Math.floor(rand() * 8),
      sideWinRates: calculateSideWinRates(rounds),
      players,
      rounds,
      evidence,
      generatedAt: new Date().toISOString()
    }
  };
}

function buildPlayers(rand) {
  const shuffled = [...BASE_NAMES].sort(() => rand() - 0.5);
  return shuffled.map((name, index) => {
    const teamId = index < 5 ? "team_a" : "team_b";
    const profileIndex = index % 5;
    return {
      id: `p${index + 1}`,
      name,
      teamId,
      steamId: `STEAM_1:1:${Math.floor(100000 + rand() * 899999)}`,
      profile: PROFILE_LABELS[profileIndex],
      issueProfile: PROFILE_ISSUES[profileIndex],
      sideStart: teamId === "team_a" ? "T" : "CT"
    };
  });
}

function buildRounds(rand, players) {
  const rounds = [];
  const targetRounds = 24;
  const plannedWinners = [
    "team_a",
    "team_a",
    "team_b",
    "team_a",
    "team_b",
    "team_b",
    "team_a",
    "team_b",
    "team_a",
    "team_a",
    "team_b",
    "team_b",
    "team_b",
    "team_a",
    "team_a",
    "team_b",
    "team_a",
    "team_b",
    "team_a",
    "team_b",
    "team_a",
    "team_a",
    "team_b",
    "team_a"
  ];

  for (let i = 1; i <= targetRounds; i += 1) {
    const winnerTeamId = plannedWinners[i - 1];
    const teamASide = i <= 12 ? "T" : "CT";
    const teamBSide = teamASide === "T" ? "CT" : "T";
    const scoreBefore = rounds.reduce(
      (acc, round) => {
        acc[round.winnerTeamId] += 1;
        return acc;
      },
      { team_a: 0, team_b: 0 }
    );
    const economyType = economyForRound(i, rand);
    const events = buildRoundEvents(rand, players, i, winnerTeamId, teamASide, teamBSide);

    rounds.push({
      number: i,
      winnerTeamId,
      winningSide: winnerTeamId === "team_a" ? teamASide : teamBSide,
      sideByTeam: { team_a: teamASide, team_b: teamBSide },
      scoreBefore,
      economyType,
      result: winnerTeamId === "team_a" ? "Team A win" : "Team B win",
      endReason: pick(["elimination", "bomb exploded", "bomb defused", "time expired"], rand),
      tags: tagRound(i, winnerTeamId, economyType),
      events
    });
  }

  return rounds;
}

function buildRoundEvents(rand, players, roundNumber, winnerTeamId, teamASide, teamBSide) {
  const events = [];
  const firstContactTeam = roundNumber % 3 === 0 ? "team_b" : "team_a";
  const attackerTeam = firstContactTeam === "team_a" ? "team_b" : "team_a";
  const victim = pick(players.filter((player) => player.teamId === firstContactTeam), rand);
  const attacker = pick(players.filter((player) => player.teamId === attackerTeam), rand);
  const location = pick(LOCATIONS, rand);

  events.push({
    id: `r${roundNumber}_e1`,
    round: roundNumber,
    time: formatRoundTime(16 + rand() * 20),
    type: "kill",
    playerId: attacker.id,
    playerName: attacker.name,
    teamId: attacker.teamId,
    side: attacker.teamId === "team_a" ? teamASide : teamBSide,
    location,
    description: `${attacker.name}在${location}拿到首杀，${victim.name}死亡后 5 秒内没有被补枪。`,
    relatedPlayerIds: [victim.id],
    impact: "opening"
  });

  events.push({
    id: `r${roundNumber}_e2`,
    round: roundNumber,
    time: formatRoundTime(34 + rand() * 18),
    type: "utility",
    playerId: pick(players, rand).id,
    playerName: "",
    teamId: "",
    side: "",
    location: pick(["top mid", "connector", "A ramp", "B apps"], rand),
    description: "关键烟闪窗口出现断档，进攻方被迫停在 choke 点。",
    relatedPlayerIds: [],
    impact: "utility"
  });

  const bombPlanter = pick(players.filter((player) => (player.teamId === "team_a" ? teamASide : teamBSide) === "T"), rand);
  events.push({
    id: `r${roundNumber}_e3`,
    round: roundNumber,
    time: formatRoundTime(70 + rand() * 20),
    type: "c4",
    playerId: bombPlanter.id,
    playerName: bombPlanter.name,
    teamId: bombPlanter.teamId,
    side: "T",
    location: pick(["A default", "B default"], rand),
    description: `${bombPlanter.name}完成下包，但队伍没有立即建立稳定交叉火力。`,
    relatedPlayerIds: [],
    impact: "post-plant"
  });

  return events.map((event) => {
    const player = players.find((candidate) => candidate.id === event.playerId);
    return {
      ...event,
      playerName: event.playerName || player?.name || "Unknown",
      teamId: event.teamId || player?.teamId || "team_a",
      side: event.side || (player?.teamId === "team_a" ? teamASide : teamBSide)
    };
  });
}

function buildEvidence(rand, players, rounds) {
  const evidence = [];
  players.forEach((player, playerIndex) => {
    player.issueProfile.forEach((issue, issueIndex) => {
      const template = ISSUE_LIBRARY.find((item) => item.issue === issue);
      const primaryRound = rounds[(playerIndex * 2 + issueIndex * 3) % rounds.length];
      const secondaryRound = rounds[(playerIndex * 2 + issueIndex * 3 + 7) % rounds.length];
      [primaryRound, secondaryRound].forEach((round, exampleIndex) => {
        const location = pick(template.locations, rand);
        const seconds = 18 + issueIndex * 19 + exampleIndex * 6 + Math.floor(rand() * 5);
        evidence.push({
          id: `ev_${player.id}_${issue}_${round.number}_${exampleIndex}`,
          playerId: player.id,
          playerName: player.name,
          teamId: player.teamId,
          round: round.number,
          time: formatRoundTime(seconds),
          location,
          issue,
          label: template.label,
          event: template.event,
          description: template.text(player.name, location),
          side: round.sideByTeam[player.teamId],
          severitySeed: clamp(0.55 + rand() * 0.38, 0, 1)
        });
      });
    });
  });
  return evidence;
}

function attachEvidenceToRounds(rounds, evidence) {
  evidence.forEach((item) => {
    const round = rounds.find((candidate) => candidate.number === item.round);
    if (!round) return;
    round.events.push({
      id: item.id,
      round: item.round,
      time: item.time,
      type: "evidence",
      playerId: item.playerId,
      playerName: item.playerName,
      teamId: item.teamId,
      side: item.side,
      location: item.location,
      description: item.description,
      relatedPlayerIds: [item.playerId],
      impact: item.issue
    });
    if (!round.tags.includes(item.issue)) {
      round.tags.push(item.issue);
    }
  });
}

function buildPlayerStats(rand, players, evidence) {
  const stats = {};
  players.forEach((player, index) => {
    const issueCount = evidence.filter((item) => item.playerId === player.id).length;
    const openingAttempts = 4 + (index % 4) + Math.floor(rand() * 3);
    const openingWins = clamp(Math.floor(openingAttempts * (0.35 + rand() * 0.35)), 1, openingAttempts);
    const kills = 12 + Math.floor(rand() * 13);
    const deaths = 10 + Math.floor(rand() * 12);
    const assists = 3 + Math.floor(rand() * 8);
    const tradeKillRate = clamp(0.28 + rand() * 0.38, 0, 1);
    const utilityEffectiveness = clamp(0.25 + rand() * 0.5 - issueCount * 0.015, 0.12, 0.88);
    stats[player.id] = {
      kills,
      deaths,
      assists,
      kd: Number((kills / Math.max(1, deaths)).toFixed(2)),
      adr: Math.round(58 + rand() * 38),
      kast: percent(clamp(0.54 + rand() * 0.29, 0, 1)),
      openingDuelWinRate: percent(openingWins / openingAttempts),
      firstDeathRate: percent(clamp(0.09 + rand() * 0.22 + issueCount * 0.005, 0, 0.45)),
      firstKillRate: percent(clamp(0.07 + rand() * 0.22, 0, 0.45)),
      tradeKillRate: percent(tradeKillRate),
      tradedDeathRate: percent(clamp(0.18 + rand() * 0.32, 0, 1)),
      timeToTradeSeconds: Number((2.2 + rand() * 4.8).toFixed(1)),
      clutchWinRate: percent(clamp(0.16 + rand() * 0.35, 0, 1)),
      utilityEffectiveness: percent(utilityEffectiveness),
      utilityDamage: Math.round(18 + rand() * 74),
      flashAssists: Math.floor(rand() * 7),
      enemiesFlashed: Math.floor(7 + rand() * 20),
      teammatesFlashed: Math.floor(rand() * 6),
      postPlantSurvival: percent(clamp(0.42 + rand() * 0.36, 0, 1)),
      repeatDeathPositions: Math.floor(1 + rand() * 5),
      siteHoldSuccess: percent(clamp(0.35 + rand() * 0.42, 0, 1)),
      rotateTimingSeconds: Number((7 + rand() * 9).toFixed(1))
    };
  });
  return stats;
}

function economyForRound(round, rand) {
  if ([2, 14].includes(round)) return "anti-eco";
  if ([3, 8, 16, 21].includes(round)) return "force buy";
  if ([5, 11, 18, 23].includes(round)) return "low utility";
  return rand() > 0.72 ? "half buy" : "full buy";
}

function tagRound(round, winnerTeamId, economyType) {
  const tags = [];
  if ([5, 8, 11, 15, 22].includes(round)) tags.push("opening_death_swing");
  if ([7, 12, 18].includes(round)) tags.push("advantage_throw");
  if ([9, 19].includes(round)) tags.push("post_plant_failure");
  if (economyType !== "full buy") tags.push("economy_swing");
  if (winnerTeamId === "team_b" && round <= 12) tags.push("failed_t_default");
  return tags;
}

function calculateSideWinRates(rounds) {
  const bySide = {
    T: { wins: 0, played: 0 },
    CT: { wins: 0, played: 0 }
  };

  rounds.forEach((round) => {
    bySide.T.played += 1;
    bySide.CT.played += 1;
    bySide[round.winningSide].wins += 1;
  });

  return {
    T: percent(bySide.T.wins / Math.max(1, bySide.T.played)),
    CT: percent(bySide.CT.wins / Math.max(1, bySide.CT.played))
  };
}

export const issueLibrary = ISSUE_LIBRARY;
