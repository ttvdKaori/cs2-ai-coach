import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 90_000;

export async function enrichReportWithAI(report, options = {}) {
  const packet = buildAIPacket(report);
  const aiBin = Object.hasOwn(options, "aiBin") ? options.aiBin : process.env.CS2_COACH_AI_BIN;
  if (!aiBin) {
    return {
      ...report,
      aiCoach: {
        mode: "rules-only",
        provider: "none",
        packetVersion: packet.version,
        status: "AI command is not configured."
      }
    };
  }

  try {
    const aiCoach = await runAICommand(aiBin, packet, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    validateAIResponse(aiCoach);
    return {
      ...report,
      aiCoach: {
        mode: "external-ai",
        provider: aiCoach.provider || "external",
        packetVersion: packet.version,
        summary: aiCoach.summary,
        priorities: aiCoach.priorities || [],
        caveats: aiCoach.caveats || []
      }
    };
  } catch (error) {
    if (process.env.CS2_COACH_AI_REQUIRED === "true" || options.requireAI === true) {
      throw new Error(`AI coach failed: ${error.message}`);
    }
    return {
      ...report,
      aiCoach: {
        mode: "rules-only",
        provider: "none",
        packetVersion: packet.version,
        status: `AI command failed; using rules-only report: ${error.message}`
      }
    };
  }
}

export function buildAIPacket(report) {
  return {
    version: "coach-evidence-v1",
    constraints: [
      "Only explain conclusions supported by evidence in this packet.",
      "Every negative suggestion must mention round/time/location evidence.",
      "Do not infer aim skill, intent, voice comms, or cheating.",
      "Mark low-confidence conclusions as possible."
    ],
    match: report.match,
    selectedTeam: report.selectedTeam.map((player) => ({
      id: player.id,
      name: player.name,
      teamId: player.teamId,
      profile: player.profile,
      stats: player.stats
    })),
    focusPlayer: report.focusPlayer,
    targetRole: report.targetRole,
    overview: report.overview,
    personalEvidence: report.personalReports.map((personal) => ({
      player: personal.player,
      recommendedRoles: personal.recommendedRoles,
      roleReason: personal.roleReason,
      habits: personal.habits.map((habit) => ({
        id: habit.id,
        issue: habit.issue,
        title: habit.title,
        severity: habit.severity,
        evidence: habit.evidence,
        specificFix: habit.specificFix,
        training: habit.training
      }))
    })),
    teamReport: report.teamReport,
    keyRounds: report.keyRounds,
    tactics: report.tactics.map((tactic) => ({
      id: tactic.id,
      name: tactic.name,
      side: tactic.side,
      economyCondition: tactic.economyCondition,
      objective: tactic.objective,
      assignments: tactic.assignments,
      whyFits: tactic.whyFits,
      evidence: tactic.evidence
    })),
    trainingPlan: report.trainingPlan
  };
}

function runAICommand(aiBin, packet, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(aiBin, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CS2_COACH_PACKET_VERSION: packet.version
      }
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`AI command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`AI command exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`AI command stdout was not valid JSON: ${error.message}`));
      }
    });
    child.stdin.end(`${JSON.stringify(packet)}\n`);
  });
}

function validateAIResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("AI response must be an object.");
  }
  if (typeof response.summary !== "string" || response.summary.length === 0) {
    throw new Error("AI response summary must be a non-empty string.");
  }
  if (response.priorities !== undefined && !Array.isArray(response.priorities)) {
    throw new Error("AI response priorities must be an array when present.");
  }
  if (response.caveats !== undefined && !Array.isArray(response.caveats)) {
    throw new Error("AI response caveats must be an array when present.");
  }
}
