# EcoScape Ops

Multi-tenant operations app for landscaping businesses: Next.js (App Router) on Supabase (Postgres, Auth, row-level security).

**Built so far:** the multi-tenant foundation (business signup and login, strict per-business data isolation) and **Customers** (add, edit, delete, list). Scheduling, crew, billing and the rest of the prototype come later.

## Product decisions in this version

The customer fields come from the Add Customer form in the prototype (`../EcoScape Ops.html`), as agreed in place of `SPEC.md`, which isn't in the repo.

| Field | Notes |
| --- | --- |
| First name, last name, phone, email | At least one of these is required so every customer can be identified. The list shows name, else phone, else email, the same as the prototype. |
| Property address, billing address | Free text. An empty billing address shows as "Same as property". |
| Gate / access instructions, service notes | Free text. |
| Preferred day | Monday–Saturday. Defaults to Monday, like the prototype. |
| Status | Active / Inactive. |
| Notification preference | Text / Email. |
| SMS opt-in | Checkbox. |
| Customer since | Defaults to today and can be edited, for importing existing customers. |

Also:

- **Not built yet:** *Payment status* is left out because billing should work it out. *Services* (name, price, frequency) wait for scheduling.
- **Duplicate phone numbers:** as in the prototype, adding a customer whose phone number is already on file asks "could this be the same customer?". The owner can add them anyway. Formatting is ignored, so `(631) 555-0142` matches `631.555.0142`.
- **Delete** is permanent and asks for confirmation first. Setting a customer to *Inactive* is the way to keep their record.
- **One business per login** for now. This is one database constraint and can be relaxed later.
- **Roles:** memberships have a role, `owner` or `crew`. Only owners can read or change customers. What crew members can see will be decided when crew features are built.

## Local development

Prerequisites: Node 20.9+ and Docker (for the local Supabase stack).

```bash
npm install
npx supabase start          # first run downloads the Supabase images
npx supabase status         # shows the API URL and publishable key
cp .env.example .env.local  # paste the publishable key in
npm run dev                 # http://localhost:3000
```

Local auth auto-confirms new accounts, so signup takes you straight in. After changing the schema, add a new file in `supabase/migrations/`, then run `npm run db:reset` and `npm run db:types`.

## Tests

| Command | What it covers | Needs |
| --- | --- | --- |
| `npm test` | Unit tests: customer validation, display name, redirect safety | nothing |
| `npm run test:db` | Tenant isolation and database rules, run through the real Supabase API as real signed-in users | `npx supabase start` |
| `npm run test:e2e` | Browser tests (desktop and mobile): signup, login and redirects, full customer add/edit/delete, validation, duplicate warning, two businesses unable to see each other's data | `npx supabase start`, `.env.local`, `npx playwright install chromium` once |

Also run `npm run lint` and `npm run typecheck`.

## Deploying to a hosted Supabase project

1. Create a project at supabase.com. Then link it and apply the schema:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
2. In the dashboard, under **Authentication → URL Configuration**, set **Site URL** to your app's URL (e.g. `https://app.example.com`). Add `https://app.example.com/**` to **Redirect URLs**.
3. Under **Authentication → Emails → Confirm signup**, replace the link in the template with the one from `supabase/templates/confirm-signup.html`:
   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/customers">Confirm my email</a>
   ```
   The default template also works, but only if the link is opened in the same browser that signed up. The token-hash link works on any device.
4. Optionally, under **Authentication → Providers → Email** (password settings), set the minimum password length to 8 to match the app.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` on your host, e.g. Vercel. Both come from **Project Settings → API**.

## How tenant isolation works

All of it lives in `supabase/migrations/20260925000000_foundation.sql`:

- `businesses` is the tenant. `business_members` links auth users to a business with a role.
- Every tenant-owned table has a non-null `business_id`, and **row-level security is on for every table**. Policies only allow rows whose `business_id` is one of the caller's businesses. The lookup uses `private.member_business_ids()` / `private.owner_business_ids()`, which live in a schema that isn't exposed through the API.
- Clients can't write memberships at all. A business and its owner membership are created together, either by a trigger when someone signs up with a `business_name`, or by the `create_business()` function for a signed-in user who has none yet.
- A customer's `business_id` can't be changed once set. The anonymous role has no access to any tenant table.
- The app code filters by business too, but only for clarity. The database enforces isolation even against hand-crafted API calls, and `tests/db/tenant-isolation.test.ts` checks this.

**Checklist for each new tenant table** (jobs, invoices, …):
1. Add `business_id uuid not null references businesses(id) on delete cascade`.
2. `enable row level security`, with policies based on `private.owner_business_ids()` / `private.member_business_ids()`.
3. Add explicit `grant`s for `authenticated` and none for `anon`.
4. Add the `prevent_business_id_change` trigger.
5. Add cross-business tests to `tests/db/`.

## Project layout

```
src/
  proxy.ts                    session refresh + signed-out redirect (Next 16's middleware)
  lib/supabase/               server client, proxy helper, generated DB types
  lib/auth.ts                 getUser / requireMembership / requireOwner
  lib/customers/schema.ts     customer fields, validation, labels
  app/(auth)/                 login, signup, auth server actions
  app/auth/confirm/           email confirmation landing route
  app/onboarding/             fallback "name your business" step
  app/(app)/                  signed-in shell (sidebar)
  app/(app)/customers/        list, new, [id], [id]/edit, server actions
supabase/
  migrations/                 schema, RLS policies
  templates/                  auth email templates
tests/
  db/                         tenant isolation tests (Vitest + supabase-js)
  e2e/                        browser tests (Playwright)
```
