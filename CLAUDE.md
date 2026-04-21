# wvu-dining-tracker

Full-stack TS monorepo. Vite+React client, Express 5 server, Supabase Postgres via Drizzle ORM.

## Rules
- TypeScript strict. No `any` without a comment.
- Frontend: NO `localStorage` / `sessionStorage`. Use TanStack Query + server state.
- DDL: always `IF NOT EXISTS` / `IF EXISTS` guards.
- Supabase service key is server-only. Client uses anon key.
- Branch off `develop`. PRs target `develop`, opened as drafts.
- Prefer editing existing files over creating new ones.
- No test suite; verify via `npm run check` and manual curl/browser.

## Layout
- `client/` Vite React (pages, components, contexts)
- `server/` Express entry; key files: coach.ts, scraper.ts, nutrition.ts, scheduler.ts, storage.ts
- `server/routes/` Express route modules (TypeScript sources; .js siblings are compiled output — ignore)
- `shared/schema.ts` Drizzle schema + Zod
- `script/build.ts` esbuild bundler for Render
- `migrations/` Drizzle SQL (do not hand-edit `meta/`)

## Commands
- `npm run dev` — tsx dev server, port 5000
- `npm run check` — tsc
- `npm run db:push` — drizzle-kit push
- `npm run build` / `npm run start` — Render production

## Reference
`.claude/docs/` — stub files for deploy, auth, and wearables. Currently empty; populate before directing Claude to read them.
