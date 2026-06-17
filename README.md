# CS2 Demo AI Coach

> Turn a Counter-Strike 2 demo into an evidence-driven coaching report for a five-player team.

Upload a `.dem`, pick your five players and a focus player, and get back a structured
review: personal bad habits, role fit, key rounds, team style, custom tactics, and a
training plan — **every suggestion bound to concrete round / time / location evidence**.

The guiding principle is *no hand-wavy verdicts*: a rule engine extracts evidence from
the parsed demo first, and the (optional) AI layer only explains and prioritizes what the
rules already found. It never invents conclusions the demo can't support.

> Status: runnable local MVP of the first product loop. Mirage only, for now.

---

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Deploy to a VPS](#deploy-to-a-vps)
- [Configuration](#configuration)
- [API](#api)
- [Parser contract](#parser-contract)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

- **One-file upload → full report.** Drag in a `.dem`, select your roster, generate.
- **Evidence-bound suggestions.** Each habit and tactic cites round number, timestamp,
  map location, and the triggering event.
- **Six report views:** match overview, personal reports, team report, key rounds,
  custom tactics, and a weekly training plan.
- **Real Go parser + safe fallback.** A `demoinfocs-golang` CLI decodes real demos; if it
  is missing or fails, a deterministic adapter keeps the product loop usable and the
  response tells you which path ran.
- **Optional AI explainer.** Plug in any command that speaks the JSON packet contract to
  get an evidence-grounded summary on top of the rule-engine output.
- **Markdown export & shareable report links.**
- **Local "useful / inaccurate" feedback** captured per suggestion for future tuning.
- **Zero runtime npm dependencies.** The server is plain Node — it runs in locked-down
  environments without `npm install`.

## How it works

```text
                upload .dem
                     │
                     ▼
        ┌────────────────────────┐
        │  parserRunner.js        │   tries the real parser first,
        │  (integration boundary) │   falls back to the JS adapter
        └────────────┬───────────┘
            real ▼                ▼ fallback
   ┌─────────────────────┐  ┌──────────────────────┐
   │ bin/cs2-demoparser   │  │ src/parser.js         │
   │ Go + demoinfocs-v4   │  │ deterministic Mirage  │
   └──────────┬──────────┘  └───────────┬──────────┘
              └───────── structured match JSON ──────────┐
                                                         ▼
                                          ┌──────────────────────────┐
                                          │ analyzer.js (rule engine) │
                                          │ habits · roles · rounds · │
                                          │ tactics · training plan   │
                                          └─────────────┬────────────┘
                                                        ▼
                                       ┌───────────────────────────────┐
                                       │ aiRunner.js (optional)         │
                                       │ compress evidence → explain    │
                                       └─────────────┬─────────────────┘
                                                     ▼
                                       report JSON  ·  Markdown export
```

The parser is a swappable boundary: as long as the JSON [contract](#parser-contract) is
preserved, the API, rule engine, and UI don't change when you upgrade the parser.

## Quick start

Requirements: **Node ≥ 20** and the **Go toolchain** (version pinned in `go.mod`).

```sh
npm run build:parser   # builds bin/cs2-demoparser from cmd/demoparser
npm start              # serves http://localhost:4173
```

Then open <http://localhost:4173>, drop in a `.dem`, pick five players + a focus player,
and generate the report. Use the **Sample** button to run the loop end-to-end without a
real demo (it exercises the deterministic fallback adapter).

Port already taken? `PORT=4174 npm start`.

> Without `bin/cs2-demoparser` present, uploads automatically use the deterministic Mirage
> adapter and the response/report expose the fallback reason. Build the parser for real
> demo decoding.

## Deploy to a VPS

`deploy.sh` is a one-click deploy for a fresh Debian/Ubuntu (or RHEL-family) VPS. It
installs Node.js and the `go.mod`-pinned Go toolchain if missing, fetches the code, builds
the parser, and runs the app as a systemd service. It is **idempotent** — re-running pulls
the latest code, rebuilds, and restarts.

```sh
curl -fsSL https://raw.githubusercontent.com/ttvdKaori/cs2-ai-coach/main/deploy.sh -o deploy.sh
sudo bash deploy.sh
```

Override defaults via environment variables:

```sh
sudo PORT=8080 APP_DIR=/srv/cs2coach RUN_USER=cs2coach bash deploy.sh
```

Manage the service:

```sh
systemctl status cs2-demo-ai-coach
journalctl -u cs2-demo-ai-coach -f      # follow logs
systemctl restart cs2-demo-ai-coach
```

| Variable      | Default                                   | Purpose                                  |
| ------------- | ----------------------------------------- | ---------------------------------------- |
| `PORT`        | `4173`                                     | Port the app listens on                  |
| `APP_DIR`     | `/opt/cs2-demo-ai-coach`                   | Install directory                        |
| `REPO_URL`    | this repo                                  | Source to clone when not run in-tree     |
| `BRANCH`      | `main`                                     | Branch to deploy                         |
| `RUN_USER`    | invoking user (`$SUDO_USER`)               | systemd service user                     |
| `NODE_MAJOR`  | `22`                                       | Node major version to install if missing |

## Configuration

The app is configured entirely through environment variables.

| Variable                      | Default                | Description                                                                 |
| ----------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `PORT`                        | `4173`                 | HTTP port (auto-increments up to 20 times if busy).                         |
| `CS2_DEMO_PARSER_BIN`         | `bin/cs2-demoparser`   | Path to the demo parser executable.                                         |
| `CS2_DEMO_PARSER_REQUIRED`    | `false`                | If `true`, fail the upload instead of falling back to the JS adapter.       |
| `CS2_DEMO_PARSER_TIMEOUT_MS`  | `240000`               | Parser execution timeout.                                                   |
| `CS2_COACH_AI_BIN`            | _(unset)_              | Optional AI command; without it reports are `rules-only`.                   |
| `CS2_COACH_AI_REQUIRED`       | `false`                | If `true`, fail report creation when the AI command errors.                 |

Uploads are capped at **500 MB** and only `.dem` files are accepted.

## API

| Method | Path                          | Description                                            |
| ------ | ----------------------------- | ----------------------------------------------------- |
| `GET`  | `/health`                     | Liveness check.                                       |
| `POST` | `/api/uploads?filename=x.dem` | Upload raw `.dem` bytes; returns parsed match data.   |
| `POST` | `/api/reports`                | Build a report from a selection (see below).          |
| `GET`  | `/api/reports`                | List report history summaries.                        |
| `GET`  | `/api/reports/:id`            | Fetch one full report.                                |
| `GET`  | `/api/reports/:id/export`     | Download the report as Markdown.                      |
| `POST` | `/api/feedback`               | Store `useful` / `inaccurate` feedback on an item.    |

Create a report:

```sh
curl -X POST http://localhost:4173/api/reports \
  -H 'content-type: application/json' \
  -d '{
    "uploadId": "upload_…",
    "teamPlayerIds": ["p1","p2","p3","p4","p5"],
    "focusPlayerId": "p1",
    "targetRole": "Support"
  }'
```

The five players must belong to the same team and the focus player must be one of them.

## Parser contract

`src/parserRunner.js` calls the parser as `$CS2_DEMO_PARSER_BIN /path/to/upload.dem` and
expects a single JSON document on stdout. Required shape:

- `parser.name`, `match.id`, `match.map`
- `match.score.team_a`, `match.score.team_b`
- `match.players[]` — `id`, `name`, `teamId`, `stats`
- `match.rounds[]` — `number`, `winnerTeamId`, `sideByTeam`, `events`
- `match.evidence[]` — `id`, `playerId`, `round`, `time`, `location`, `description`

Output is validated (`validateParsedDemo`); invalid output triggers the fallback unless
`CS2_DEMO_PARSER_REQUIRED=true`.

The bundled Go parser computes, from real demos: map/header, players and stable team ids,
round boundaries, score and side win rates, kills, first deaths, damage/ADR, K/D, **opening
duel win rate**, **trade kills / traded deaths / time-to-trade**, **KAST**, utility damage
and flash results, C4 and grenade timelines, and event-backed evidence. A few advanced
stats (clutch win rate, post-plant survival, site-hold success, rotate timing) are still
placeholders pending last-alive / round-phase tracking.

## Project layout

```text
cmd/demoparser/main.go   Go demo parser (demoinfocs-golang v4)
src/server.js            dependency-free HTTP server + routes
src/parserRunner.js      parser integration boundary + output validation
src/parser.js            deterministic Mirage fallback adapter
src/analyzer.js          rule engine: habits, roles, rounds, tactics, training
src/aiRunner.js          optional AI explainer (evidence packet contract)
src/markdown.js          report → Markdown exporter
public/                  single-page UI (no framework)
test/                    node:test suites + mock parser/AI fixtures
deploy.sh                one-click VPS deploy (systemd)
docs/PRD.md              product requirements
docs/IMPLEMENTATION.md   implementation notes & contracts
```

## Testing

```sh
npm test                                        # node:test suites
GOCACHE=$(pwd)/.cache/go-build go vet ./...      # static checks for the parser
npm run build:parser                            # confirm the parser compiles
```

## Roadmap

Aligned with `docs/PRD.md`:

- **V0.1 — technical validation (now):** upload, parse, evidence-driven report, optional AI.
- **V0.2 — single-player review:** richer habit detection and per-player drilling.
- **V0.3 — five-player team analysis:** role identification, team strengths/weaknesses,
  fully custom tactics.
- **V0.4 — shareable product:** more maps, 2D minimap replay, tactics board, demo history.
- **V1.0 — commercial:** team spaces, multi-demo trends, tactics library, paid reports.

## License

[MIT](LICENSE) © aroma
