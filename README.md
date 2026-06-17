# CS2 Demo AI Coach

CS2 Demo AI Coach turns a CS2 demo upload into an evidence-driven coaching report for a five-player team.

The current repository implements the PRD's first-stage product loop as a runnable local MVP:

1. Upload a `.dem` file.
2. Parse it into Mirage match structure.
3. Select the user's five-player team and focus player.
4. Generate match overview, personal reports, team report, key rounds, tactics, and training plan.
5. Export the report as Markdown.

## Run

```sh
npm run build:parser
npm start
```

Open `http://localhost:4173`.

Use `PORT=4174 npm start` if the default port is occupied.

## Test

```sh
npm test
```

## Documentation

- [Product Requirements Document](docs/PRD.md)
- [Implementation Notes](docs/IMPLEMENTATION.md)

## Current Parser Status

The app now includes a real parser CLI at `cmd/demoparser`, built with `demoinfocs-golang`:

```sh
npm run build:parser
```

When `bin/cs2-demoparser` exists, uploads automatically try that parser first. Set `CS2_DEMO_PARSER_BIN=/path/to/parser` to override it.

If the real parser is missing or fails, the app falls back to `src/parser.js`, a deterministic Mirage adapter that validates `.dem` uploads and produces stable structured match data for product verification. Upload responses and reports expose the fallback reason.

The current Go parser extracts map/header, players, rounds, kills, damage, C4 events, score, and event-backed evidence. Utility, economy, and path summaries are intentionally conservative and should be expanded with more real demo samples.
