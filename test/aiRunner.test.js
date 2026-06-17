import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport } from "../src/analyzer.js";
import { enrichReportWithAI, buildAIPacket } from "../src/aiRunner.js";
import { parseDemo } from "../src/parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const upload = {
  id: "upload_aaaaaaaaaaaaaaaa",
  originalName: "mirage.dem",
  size: 128,
  sha256: "db7d08f5bb1b6080c8515da50457b671cb09755e56a13c2a86a982b8cbb12d3b"
};

function fixtureReport() {
  const parsed = parseDemo(upload);
  const teamPlayers = parsed.match.players.filter((player) => player.teamId === "team_a").slice(0, 5);
  return buildReport(parsed, {
    teamPlayerIds: teamPlayers.map((player) => player.id),
    focusPlayerId: teamPlayers[0].id,
    targetRole: "Support"
  });
}

test("AI packet contains evidence and safety constraints", () => {
  const report = fixtureReport();
  const packet = buildAIPacket(report);

  assert.equal(packet.version, "coach-evidence-v1");
  assert.ok(packet.constraints.some((constraint) => constraint.includes("evidence")));
  assert.equal(packet.selectedTeam.length, 5);
  assert.ok(packet.personalEvidence[0].habits[0].evidence.length > 0);
  assert.ok(packet.tactics[0].evidence.length > 0);
});

test("enrichReportWithAI defaults to rules-only mode", async () => {
  const report = await enrichReportWithAI(fixtureReport(), { aiBin: "" });
  assert.equal(report.aiCoach.mode, "rules-only");
  assert.equal(report.aiCoach.provider, "none");
});

test("enrichReportWithAI attaches external AI output when configured", async () => {
  const report = await enrichReportWithAI(fixtureReport(), {
    aiBin: path.join(root, "tools", "mock-ai-coach.sh")
  });

  assert.equal(report.aiCoach.mode, "external-ai");
  assert.equal(report.aiCoach.provider, "mock-ai");
  assert.match(report.aiCoach.summary, /fixture summary/);
  assert.ok(report.aiCoach.priorities.length > 0);
});

test("enrichReportWithAI falls back to rules-only on AI failure", async () => {
  const report = await enrichReportWithAI(fixtureReport(), {
    aiBin: path.join(root, "tools", "mock-invalid-parser.mjs")
  });

  assert.equal(report.aiCoach.mode, "rules-only");
  assert.match(report.aiCoach.status, /failed/);
});
