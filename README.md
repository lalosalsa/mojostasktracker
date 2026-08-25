# Mojo's Task Tracker

A shared to-do list for a working crew, broken into the named blocks of your day
— Morning Prep, Lunch Rush, Closing. The manager fills each block with what needs
doing; the crew opens the app to that list, and whoever does a job attaches the
photo that proves it and has their name recorded against it. The manager sees it
all live and signs off on the proof.

A manager creates a team and shares a 6-character code; the crew signs up with
their name and email, types the code, and they're in.

Installs to a phone's home screen and opens like a normal app — no app store,
no passwords to remember.

**Stack:** a static progressive web app on **Vercel**, with **Supabase** as the
only backend (Postgres + Auth + Storage). No server to run or maintain.

👉 **Deploying it for the first time? Follow [SETUP.md](SETUP.md).**

---

## What it does

**Signing up**

- Name, email and a password. No emails are sent at all — no codes, no links, no
  confirmation. The phone stays signed in afterwards.
- A manager creates a team and gets a **crew code** to share, plus a separate
  **manager code** for anyone who should also review work.
- Everyone else joins by typing that code. Coming back on any device is the same
  email and password.
- Teams are sealed off from each other: no code, no access.

**For the crew**

- "Today" is the whole crew's list, grouped under the blocks of the day with how
  many are done in each.
- Nothing is pre-assigned: pick up whatever needs doing. Finishing a task puts
  your name on it, so the manager can see who did what.
- A finished task drops off everyone's list straight away, so nobody redoes a job
  someone else already did. A task sent back for a redo reappears.
- History keeps a record of everything you personally finished.
- The crew's screen is only the manager's list — there's nothing else to learn.
- Open a task → take photos → add notes → mark it done.
- A task that requires a photo *cannot* be marked done without one. That rule is
  enforced in the database, not just in the app.
- History of everything they've completed, day by day.

**For the manager**

- Overview: how much of today's work is done, a per-person scoreboard, and a
  **Finished today** feed — every completed job with the photo proof and the name
  of whoever did it, newest first.
- Look back a full week: the task board opens on a strip of the last seven days
  showing how much of each got finished, so you can check Tuesday actually got
  done. Any older date works too.
- Review queue: photo proof for every finished task — verify it, or send it back
  with a note telling the crew what to fix.
- Blocks: name the parts of the day, reorder them, and fill each with its
  standing list of jobs. That list rebuilds itself every morning — and a task
  added mid-day appears on the crew's phones immediately.
- Any task can be limited to particular weekdays — any combination, so a
  Mon/Wed/Fri job only shows up on those days.
- Task board: everything for a chosen day, grouped by block, with who finished
  what. A job can still be pinned to one person if you want.
- Team: share or re-issue the join code, promote someone to manager, edit names,
  turn off access, or remove someone from the team entirely — their finished work
  and photos stay in your records.
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

- Row level security scopes everything to your own team first, then to your own
  tasks and photos; a manager sees their whole team and nothing beyond it.
- Photos live in a **private** storage bucket, served through short-lived signed
  URLs. Files are laid out as `<user-id>/<task-id>/<file>` and storage policies
  keep people out of each other's folders.
- Employees cannot verify their own work, promote themselves, reassign a task,
  or edit a manager's review note — database triggers reject all of it.
- Signing up gets you an account but no team. Until you enter a valid code you
  can see nothing at all.
- Join codes skip characters people misread (no O, I or L) and a manager can
  rotate them at any time.

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
one team cannot see another team's blocks, tasks, members or photos; a wrong
code is refused; the day's list builds exactly once; the crew can't edit the
blocks; finishing a task records who did it and reopening clears it; nobody can
finish without a photo, verify themselves, or promote themselves; and the last
manager can't strand a team.

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
supabase/reset.sql   drops it all, for starting over from an older version
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
