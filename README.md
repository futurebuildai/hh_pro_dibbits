# HH Pro

AI-native procurement portal for contractors buying from hardscape (lumber & building
materials) suppliers. Plan → Quote → Order → Invoice, in one board.

```bash
npm install
npm run dev        # http://localhost:5173
```

**→ [User guide](docs/user-guide.md)** — an end-to-end walkthrough with screenshots.

## Commands

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build |
| `npm test` | Vitest |
| `npm run check` | Format + lint (Biome) |
| `npm run guide` | Recapture every user-guide screenshot |

Architecture and conventions live in [CLAUDE.md](CLAUDE.md). The one rule that
matters: **`src/core/` is framework-free** — all domain, pricing, and ERP logic
is plain TypeScript, so the React layer stays replaceable.
