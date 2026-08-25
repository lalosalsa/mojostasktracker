# Mojo's Task Tracker

A task tracker for a working crew. Employees sign in once with their email,
work through the day's list on their phone, and attach photos that prove each
job is finished. The manager sees it all live and signs off on the proof.

Installs to a phone's home screen and opens like a normal app — no app store,
no passwords to remember.

**Stack:** a static progressive web app on **Vercel**, with **Supabase** as the
only backend (Postgres + Auth + Storage). No server to run or maintain.

👉 **Deploying it for the first time? Follow [SETUP.md](SETUP.md).**

---

## What it does

**For the crew**

- Sign in with a work email and a 6-digit code — then the phone stays signed in.
- "Today" screen with the day's assigned work, progress ring, and what's left.
- Open a task → take photos → add notes → mark it done.
- A task that requires a photo *cannot* be marked done without one. That rule is
  enforced in the database, not just in the app.
- Log ad-hoc work that wasn't assigned ("Log a task"), photos and all.
- History of everything they've completed, day by day.

**For the manager**

- Overview: how much of today's work is done, per-person scoreboard, live
  activity feed, 14-day trend.
- Review queue: photo proof for every finished task — verify it, or send it back
  with a note telling the crew what to fix.
- Task board: assign work to anyone, for any day, with priority and location.
- Recurring checklists: daily / weekday / weekly jobs that appear automatically
  each morning.
- Team: invite by email, approve people who sign themselves up, promote another
  manager, or turn off access instantly.
- Reports: totals over any date range plus a CSV export for payroll or clients.

**As an app**

- Add to Home Screen on iPhone and Android; opens full-screen with its own icon.
- App shell is cached, so it launches instantly and shows a proper screen when
  the signal drops.
- Photos are shrunk on the phone before upload (a 12 MP photo becomes a few
  hundred KB), which keeps it usable on site data.
- Light and dark mode.

## Security model

Every rule lives in Postgres, so a tampered client cannot get around it:

- Row level security scopes each crew member to their own tasks and photos; a
  manager sees everything.
- Photos live in a **private** storage bucket, served through short-lived signed
  URLs. Files are laid out as `<user-id>/<task-id>/<file>` and storage policies
  keep people out of each other's folders.
- Employees cannot verify their own work, promote themselves, reassign a task,
  or edit a manager's review note — database triggers reject all of it.
- People who sign up on their own land in a waiting room with no access at all
  until a manager approves them.

## Local development

```bash
npm install
cp .env.example .env.local        # fill in your Supabase URL + anon key
npm start                         # builds and serves on http://localhost:3000
```

`npm run dev` rebuilds on every change. If you skip the env vars entirely the
app opens a setup screen and asks for the URL and key, storing them in that
browser only — handy for poking at a project without a rebuild.

### Tests

```bash
npm i -D playwright && npx playwright install chromium   # one-time, for npm test
npm run build && npm test   # boots the built app in Chromium against a mocked Supabase
npm run test:db             # applies the schema to a throwaway Postgres, exercises RLS
```

Playwright is deliberately *not* a dependency — it would be downloaded on every
Vercel deploy for no reason.

`npm test` walks the manager and crew screens, uploads a photo through the real
resize → storage → database path, and checks the service worker precaches the
shell. Screenshots land in `test/shots/`.

`npm run test:db` needs PostgreSQL 16 installed locally. It proves the schema
applies cleanly (twice — it's idempotent) and then checks the rules that matter:
employees can't see each other's work, can't finish a task without a photo,
can't verify themselves, and pending users can do nothing.

## Project layout

```
src/                 app source (plain ES modules, no framework)
  main.js            boot, session handling, header + tabs, routing
  data.js            every Supabase query in one place
  supabase.js        client setup and human-readable error messages
  photos.js          capture, compress, upload, gallery, full-screen viewer
  camera.js          canvas resize pipeline + optional location tag
  views/             one file per screen
  index.html         app shell   styles.css   manifest   sw.js   icons/
supabase/schema.sql  tables, RLS policies, triggers, RPCs, storage bucket
scripts/build.js     esbuild bundle → public/, stamps the service worker
scripts/generate-icons.js   draws the PNG app icons from scratch
test/                browser smoke test + SQL rule tests
vercel.json          build config, SPA rewrite, cache + security headers
```

`public/` is generated — never edit it by hand.

## Configuration

| Variable | Required | What it does |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | yes | Supabase anon/public key (safe to ship; RLS protects the data) |
| `APP_NAME` | no | Name in the header, tab title and installed app |
| `APP_SHORT_NAME` | no | Short name under the home-screen icon |
