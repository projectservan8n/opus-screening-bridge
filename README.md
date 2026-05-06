# Opus Screening Bridge

Bridge service for the Opus Automations hiring system. Connects the candidate-facing chat on `opusautomations.com/jobs/{slug}` to Nico (AI screening) without modifying the main Tarsee instance.

## What it does

- Hosts the `/api/roles` and `/api/screening` endpoints
- Manages per-candidate conversation state in Postgres
- Calls Anthropic Claude with a Nico-screener system prompt to generate replies
- Writes completed screenings to a Google Sheet and uploads transcripts to Drive
- Pings Tony on Telegram when a candidate scores PASS

## Adding a new role

1. Create `roles/{slug}.json` matching the schema in the `opus-hiring` skill
2. Validate: `node scripts/validate-role-spec.js roles/{slug}.json` (script lives in the skill)
3. Commit + push to main, Railway redeploys
4. New role is live at `opusautomations.com/jobs/{slug}`

## Local dev

```bash
cp .env.example .env
# fill in DATABASE_URL, ANTHROPIC_API_KEY, etc.
npm install
npm run init-db
npm run dev
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/roles` | List open roles |
| GET | `/api/roles/:slug` | Get role detail |
| POST | `/api/screening/:slug/start` | Start or resume a session |
| POST | `/api/screening/:slug/:candidateId/message` | Send a message, get Nico's reply |
| GET | `/api/screening/:slug/:candidateId/messages` | Get conversation history |

See `src/server.js` for the full implementation.
