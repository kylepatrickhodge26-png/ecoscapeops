@AGENTS.md

## EcoScape Ops

- Product decisions so far, and the checklist every new tenant table must follow (business_id, RLS, grants, tests), are in README.md.
- Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run test:e2e`. The last two need the local Supabase stack (`npx supabase start`).
- After changing the schema: add a migration in `supabase/migrations/`, run `npm run db:reset`, then `npm run db:types`.
- In Claude Code cloud sessions: start Docker with `dockerd &`, and prefix Supabase CLI commands with `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` (the proxy blocks public.ecr.aws). Run Playwright with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`.
