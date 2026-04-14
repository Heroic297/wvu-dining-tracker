# AGENTS.md

## Commands
```bash
npm run dev       # Start dev server with tsx (ports 5000)
npm run build     # Build for production
npm run check     # TypeScript check
npm run db:push   # Run drizzle-migrations to DB
```

## Architecture
```
wvu-dining-tracker/
├── client/        # React + Vite (src/pages, components, contexts)
├── server/        # Express backend
│   ├── coach.ts  # AI chat endpoint (Groq/OpenRouter free models)
│   ├── scraper.ts # WVU dining menus (DineOnCampus API)
│   ├── nutrition.ts # USDA + AI nutrition lookup
│   ├── scheduler.ts # node-cron background jobs
│   └── storage.ts # DB CRUD layer
├── shared/
│   └── schema.ts # Drizzle ORM schema + Zod
├── script/
│   └── build.ts  # Server-side ESBuild bundling for Render
```

## Key Details

**AI Coach** uses free-tier models:
- Groq: `llama-3.1-8b-instant` (recommended), `llama-3.3-70b-versatile`
- OpenRouter: `qwen/qwen3.6-plus:free`, etc.
- Dead model auto-migration handled in `coach.ts`
- Compaction threshold: 5 messages (generates rolling summary)

**Database**: PostgreSQL via Supabase, Drizzle ORM
- Tables: `users`, `wearable_tokens`, `daily_activity`, `dining_*`, `nutrition_cache`, `user_meals`, `weight_log`, `ai_profiles`, `chat_messages`

**Authentication**: JWT + express-session, password reset via Supabase

**Wearables**: OAuth2 for Garmin/Fitbit (approval can take days for Garmin)

**Scraping**: DineOnCampus API (`api.dineoncampus.com`). Check location IDs if API changes.

**Render Deployment**:
- Build: `npm install && npm run build`
- Start: `npm run start`
- Cron endpoint: `POST /api/jobs/scrape` with `x-cron-secret` header
- Cron secret must be set in env as `CRON_SECRET`

**Env Variables**: All in `.env` - see `.env.example`. Required:
- `DATABASE_URL` (Supabase URI)
- `JWT_SECRET`, `SESSION_SECRET` (openssl rand -hex 32)
- `GROQ_API_KEY` or `OPENROUTER_API_KEY`
- `USDA_API_KEY` (optional, DEMO_KEY fallback)
- Fitbit/Garmin OAuth credentials and redirect URIs

**Testing**: No test suite present. Manual testing in browser or via curl.

## Gotchas
- Groq keys are encrypted at rest (AES-256) in `users` table
- Master Groq key provides fallback for users with missing/corrupt keys
- Context prompt injection filtering applied to user input
- AI config auto-migrates dead models and provider mismatches
- Compaction only deletes messages after generating summary (never loses recent window)
