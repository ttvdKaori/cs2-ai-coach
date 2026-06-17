#!/usr/bin/env sh
cat <<'JSON'
{
  "parser": {
    "name": "mock-real-parser",
    "mode": "fixture"
  },
  "match": {
    "id": "match_from_mock_real_parser",
    "map": "Mirage",
    "supportedMap": true,
    "score": {
      "team_a": 1,
      "team_b": 0
    },
    "teams": [
      {
        "id": "team_a",
        "name": "Team A"
      },
      {
        "id": "team_b",
        "name": "Team B"
      }
    ],
    "roundsPlayed": 1,
    "durationMinutes": 2,
    "sideWinRates": {
      "T": "100%",
      "CT": "0%"
    },
    "players": [
      { "id": "p1", "name": "Player1", "teamId": "team_a", "stats": {} },
      { "id": "p2", "name": "Player2", "teamId": "team_a", "stats": {} },
      { "id": "p3", "name": "Player3", "teamId": "team_a", "stats": {} },
      { "id": "p4", "name": "Player4", "teamId": "team_a", "stats": {} },
      { "id": "p5", "name": "Player5", "teamId": "team_a", "stats": {} },
      { "id": "p6", "name": "Player6", "teamId": "team_b", "stats": {} },
      { "id": "p7", "name": "Player7", "teamId": "team_b", "stats": {} },
      { "id": "p8", "name": "Player8", "teamId": "team_b", "stats": {} },
      { "id": "p9", "name": "Player9", "teamId": "team_b", "stats": {} },
      { "id": "p10", "name": "Player10", "teamId": "team_b", "stats": {} }
    ],
    "rounds": [
      {
        "number": 1,
        "winnerTeamId": "team_a",
        "sideByTeam": {
          "team_a": "T",
          "team_b": "CT"
        },
        "events": []
      }
    ],
    "evidence": [
      {
        "id": "ev_fixture",
        "playerId": "p1",
        "round": 1,
        "time": "0:20",
        "location": "top mid",
        "description": "Fixture evidence"
      }
    ]
  }
}
JSON
