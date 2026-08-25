# Setting it up

Two accounts, both free to start: **Supabase** (the database, sign-in and photo
storage) and **Vercel** (hosts the app). Budget about 20 minutes.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Name it (e.g. `mojos-tasks`), pick a region near your crew, and save the
   database password somewhere safe.
3. Wait for it to finish provisioning (a minute or two).

## 2. Create the database

1. In your project, open **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this repo, copy **the whole file**, paste it
   in, and press **Run**.
3. You should see "Success. No rows returned."

That one file creates every table, the security rules, the photo bucket, and the
automatic daily-checklist logic. It's safe to re-run later if you pull updates.

## 3. Turn off email confirmation

Sign-in is email + password, and the app sends **no email at all**. Supabase
wants to email a confirmation link by default, so switch that off or nobody can
finish signing up.

1. **Authentication** → **Sign In / Providers** → **Email**.
2. Make sure **Enable email provider** is on.
3. Turn **Confirm email** **OFF**.
4. Leave **Allow new users to sign up** on — that's how your crew creates
   accounts. Getting into *your* team still needs the team code from step 8.
5. Save.

If you miss this, sign-up appears to work but the app will tell you email
confirmation is still switched on.

## 4. Email (optional now)

You don't need SMTP for day-to-day use — no codes, no links, no confirmation
emails. The one thing that still needs it is **Forgot password**.

Until you set it up, a forgotten password is fixed by a manager: remove the
person from the team, and they sign up again with a fresh password.

If you do want password resets to work, set up SMTP under **Project Settings** →
**Authentication** → **SMTP Settings**. A Gmail app password works
([myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
host `smtp.gmail.com`, port `587`), as does any provider like Resend or Brevo.

## 5. Copy your keys

**Project Settings** → **API**. You need two values:

- **Project URL** — `https://xxxxxxxxxxxx.supabase.co`
- **anon public** key — the long `eyJ…` string

The anon key is meant to be public; the row-level security rules from step 2 are
what actually protect the data.

## 6. Deploy to Vercel

1. Push this repo to GitHub (see below if it isn't there yet).
2. [vercel.com](https://vercel.com) → **Add New** → **Project** → import the repo.
3. Framework preset: **Other**. Leave build and output settings alone —
   `vercel.json` already sets them.
4. Add **Environment Variables**:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_ANON_KEY` | your anon public key |
   | `APP_NAME` | *(optional)* e.g. `Mojo's Task Tracker` |
   | `APP_SHORT_NAME` | *(optional)* short name under the icon, e.g. `Tasks` |

5. **Deploy**. You'll get a URL like `https://mojos-tasks.vercel.app`.

> Changing an environment variable later? Redeploy afterwards — the values are
> baked in at build time.

### Used the Vercel ↔ Supabase connector instead?

That's fine — it adds the environment variables for you (`SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and friends), and the build accepts any of
those names automatically. Two things to know:

**Redeploy after connecting.** The keys are baked into the app at build time, so
a deployment that ran *before* you connected Supabase has no connection in it —
it will open a "Connect your database" screen instead of the sign-in screen. In
Vercel: **Deployments** → the latest one → **⋯** → **Redeploy**.

**Check the build log to confirm.** Open the deployment's build log and look for:

```
Supabase: https://xxxxxxxx.supabase.co (from SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY)
```

If instead it prints "Supabase connection NOT baked into this build", the log
lists exactly what's missing or wrong.

**The connector does not do steps 2, 3, 4 or 7.** It wires up credentials and
nothing else — you still have to run the schema SQL, put `{{ .Token }}` in the
Magic Link email, set up SMTP, and set the redirect URLs below.

## 7. Point Supabase at your live URL

Back in Supabase: **Authentication** → **URL Configuration**.

- **Site URL**: `https://your-app.vercel.app`
- **Redirect URLs**: add `https://your-app.vercel.app/**`

## 8. Create your team

Open your Vercel URL and tap **Create an account**. Enter your name, email and a
password, then choose **Create a new team** and name your business.

You're the manager. The app shows you a **6-character crew code** — that's what
your crew types to join. You can see it again any time under **Team**.

## 9. Get your crew in

Send them the app link. Each person taps **Create an account**, enters their
name, email and a password, then chooses **I have a team code** and types your
crew code.

That's it — they're on your team and can start logging work.

Two things worth knowing:

- **Team** → **Share** copies a ready-made invite (link + code) you can paste
  into a group text.
- There's a separate **manager code** under Team, for anyone who should also
  see everyone's work and sign off on photos. Only share that one deliberately.
- If a code gets out, **New code** issues a fresh one. People already on the
  team stay on it.
- To promote someone, open them under **Team** and switch **Role** to Manager.
- To remove someone, open them under **Team** → **Remove from the team**. Their
  finished work and photos stay in your records; anything still open goes back
  in the pool.

## 10. Get it onto their phones

Tell each person to open the link in their phone browser and:

- **iPhone (Safari):** Share button → **Add to Home Screen** → Add.
- **Android (Chrome):** ⋮ menu → **Install app** (or *Add to Home screen*).

It then opens full-screen from the home screen icon, like any other app, and
stays signed in.

## 11. More than one location (optional)

If you run several shops, each one is its own team: its own crew, its own blocks,
its own history. Nothing is shared between them.

Tap the location name in the **top right**, next to your profile icon:

- **Add another location** — name it and you're its manager, with a fresh crew
  code to hand out. (Only managers see this. Crew join with a code.)
- **Join a team with a code** — for a location someone else runs.
- Tap any location in the list to switch to it. The whole app follows: today's
  list, the blocks, the crew, the reports.

Someone who works at two of your shops joins each one with its code and switches
the same way. Their work at each stays separate.

## 12. Build the day

This is the part that makes the app yours.

**Blocks** tab → **New block**. Name it the way your crew talks about the day —
"Opening", "Morning Prep", "Lunch Rush", "Closing". Times are optional; add them
and the crew sees "7am – 11am" under the heading, leave them off and it just
reads "any time".

Then **Add a task to <block>** for each job in it. For each one you can set:

- **Which days** — tap the S M T W T F S buttons to pick any combination. All
  seven are on by default; turn some off for a job that's only Mon/Wed/Fri, or
  weekends only.
- Whether a **photo** is required (on by default).
- **Priority** and **location**.
- Whether it's open to anyone or pinned to one person.

Use the ↑ ↓ buttons to put the blocks in the order the day actually runs.

That's it. Every morning the app turns those blocks into that day's list on
everyone's phone. Add a task at 2pm and it shows up right away.

## Pushing this repo to GitHub

```bash
git remote -v                      # confirm the remote
git push -u origin main
```

## Day-to-day

- **Crew:** open the app → the day's list is there, grouped by block → do a job,
  photo it, mark it done. Their name goes on it automatically and it drops off
  the list, so nobody doubles up.
- **You:** Overview shows **Finished today** — each completed job with its photo
  and who did it. Review is where you sign off. The Tasks tab opens on the last
  seven days, so you can tap back through the week and confirm previous days
  were finished. Reports → **Download CSV** for records.

## Costs

Both free tiers comfortably cover a small crew. Supabase free includes 500 MB of
database and 1 GB of file storage — photos are compressed to a few hundred KB
each, so that's thousands of them. If you outgrow it, Supabase Pro is $25/month
and Vercel stays free for this kind of site.

## Troubleshooting

**"Email confirmation is still switched on."** Do step 3 — Authentication →
Sign In / Providers → Email → turn **Confirm email** off.

**Someone forgot their password.** Password resets need SMTP (step 4). Without
it, remove them under Team and have them sign up again.

**"That team code does not match any team."** Codes are 6 characters and skip
easily-confused letters (no O, I or L — those are zero, one and one). Read it
off the Team screen and re-send it.

**Someone joined the wrong team.** They can switch or leave from the location
button in the top right.

**A manager can't add a location.** Only someone who already manages a team can
create another. If they're crew everywhere, give them the manager code for one of
your locations first.

**Screens error out right after signing in.** The database tables aren't there —
run `supabase/schema.sql` (step 2).

**The crew's list is empty.** No blocks have tasks in them yet — go to **Blocks**
and add some. The list builds from there.

**A task I added didn't show up.** It appears on today's list as soon as you save
it. If the crew's phone still shows the old list, they can pull down to refresh
or reopen the app.

**Photos will not upload / "does not have permission".** The storage rules are
missing. On some Supabase projects the SQL editor isn't allowed to create them,
and the schema prints a notice saying so rather than failing.

First check **Storage** in the sidebar shows a bucket called `task-photos` with
**Public** off. If it isn't there, create it: **New bucket** → name `task-photos`
→ leave Public **off** → Save.

Then **Storage** → **Policies** → on the `objects` table → **New policy** →
*For full customization*, and add these four. Each one is for the
**authenticated** role, on the `task-photos` bucket:

| Policy name | Operation | Expression (USING / WITH CHECK) |
|---|---|---|
| `task_photos_insert` | INSERT | `bucket_id = 'task-photos' and (storage.foldername(storage.objects.name))[1] = public.me()::text` |
| `task_photos_select` | SELECT | `bucket_id = 'task-photos' and ((storage.foldername(storage.objects.name))[1] = public.me()::text or (public.is_manager() and exists (select 1 from public.members m where m.id::text = (storage.foldername(storage.objects.name))[1] and m.team_id = public.my_team())))` |
| `task_photos_update` | UPDATE | same expression as insert |
| `task_photos_delete` | DELETE | same expression as select |

In plain terms: everyone writes into their own folder, everyone reads their own
photos, and a manager reads their whole team's.

**"Your account does not have permission for that."** Row-level security doing
its job — that person is on a different team, or their access was turned off.

**I ran an older version of this schema.** Run `supabase/reset.sql` once, then
`supabase/schema.sql`. That clears the old tables — only do it while you have no
real data.

**The app looks stale after a deploy.** Fully close it and reopen; the service
worker picks up the new version on next launch.
