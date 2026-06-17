import test from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/analyzer.js";
import { parseDemo } from "../src/parser.js";

const upload = {
  id: "upload_0123456789abcdef",
  originalName: "mirage.dem",
  size: 128,
  sha256: "7c65f3cc1e04f7b6a1f82bb9349a7e5d82de66f3d07a132ea3f70e189c8626b5"
};

test("parser creates a Mirage match with structured rounds, players, and evidence", () => {
  const parsed = parseDemo(upload);

  assert.equal(parsed.match.map, "Mirage");
  assert.equal(parsed.match.supportedMap, true);
  assert.equal(parsed.match.players.length, 10);
  assert.equal(parsed.match.rounds.length, 24);
  assert.ok(parsed.match.evidence.length >= 50);

  const evidence = parsed.match.evidence[0];
  assert.match(evidence.id, /^ev_/);
  assert.equal(typeof evidence.round, "number");
  assert.match(evidence.time, /^\d+:\d{2}$/);
  assert.ok(evidence.location.length > 0);
  assert.ok(evidence.description.includes(evidence.playerName));
});

test("parser rejects non-dem uploads", () => {
  assert.throws(
    () => parseDemo({ ...upload, originalName: "not-a-demo.txt" }),
    /Only \.dem files/
  );
});

test("report satisfies the MVP evidence-driven report shape", () => {
  const parsed = parseDemo(upload);
  const teamPlayers = parsed.match.players.filter((player) => player.teamId === "team_a").slice(0, 5);
  const report = buildReport(parsed, {
    teamPlayerIds: teamPlayers.map((player) => player.id),
    focusPlayerId: teamPlayers[0].id
  });

  assert.equal(report.selectedTeam.length, 5);
  assert.equal(report.personalReports.length, 5);
  assert.ok(report.evidenceCount >= 10);
  assert.equal(report.keyRounds.length, 5);
  assert.equal(report.tactics.length, 4);
  assert.ok(report.tactics.some((tactic) => tactic.economyCondition.includes("eco")));
  assert.equal(report.targetRole, "Auto");
  assert.ok(report.trainingPlan.weekPlan.length >= 4);

  for (const personal of report.personalReports) {
    assert.ok(personal.habits.length >= 3);
    assert.ok(personal.recommendedRoles.length >= 2);
    assert.match(personal.stats.utilityEffectiveness, /^\d+%$/);
    for (const habit of personal.habits) {
      assert.ok(habit.title);
      assert.ok(habit.specificFix);
      assert.ok(habit.training);
      assert.ok(habit.evidence.length >= 2);
      habit.evidence.forEach((item) => {
        assert.equal(typeof item.round, "number");
        assert.match(item.time, /^\d+:\d{2}$/);
        assert.ok(item.location);
        assert.ok(item.event);
      });
    }
  }

  for (const tactic of report.tactics) {
    assert.equal(tactic.map, "Mirage");
    assert.equal(tactic.assignments.length, 5);
    assert.ok(tactic.openingSetup);
    assert.ok(tactic.utility.length >= 4);
    assert.ok(tactic.timing);
    assert.ok(tactic.contingency);
    assert.ok(tactic.whyFits);
    assert.ok(tactic.evidence.length >= 2);
  }
});

test("report rejects cross-team player selections", () => {
  const parsed = parseDemo(upload);
  const mixedPlayers = [
    ...parsed.match.players.filter((player) => player.teamId === "team_a").slice(0, 4),
    parsed.match.players.find((player) => player.teamId === "team_b")
  ];

  assert.throws(
    () =>
      buildReport(parsed, {
        teamPlayerIds: mixedPlayers.map((player) => player.id),
        focusPlayerId: mixedPlayers[0].id
      }),
    /same team/
  );
});

test("report rejects unsupported maps for the Mirage MVP", () => {
  const parsed = parseDemo(upload);
  parsed.match.map = "Inferno";
  parsed.match.supportedMap = false;
  const teamPlayers = parsed.match.players.filter((player) => player.teamId === "team_a").slice(0, 5);

  assert.throws(
    () =>
      buildReport(parsed, {
        teamPlayerIds: teamPlayers.map((player) => player.id),
        focusPlayerId: teamPlayers[0].id
      }),
    /Only Mirage is supported/
  );
});
