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

## 11. Set up the daily checklist (optional)

**More → Recurring tasks** — add the jobs that happen every day or every week.
They appear on the crew's Today screen automatically each morning.

## 12. Working from your Square schedule (optional)

If you roster people in Square, the app can hand out work based on who is
actually clocked on.

**One-time setup — say what needs doing when:**

**Schedule** tab → **Time blocks** → **New time block**. Each one is a job plus
the window it has to happen in, e.g. "Restock the front cooler, between 2:00 and
4:00 PM". Choose whether it goes to *everyone on shift* in that window or to
*just one person*.

**Each week — import the schedule:**

1. In Square, export the schedule (**.xlsx** or **.csv**, one row per shift).
2. **Schedule** tab → **Import schedule** → pick the file.
3. The app guesses which columns hold the employee, date and times, and shows you
   what it read before saving anything. Fix the dropdowns if a column is wrong.
   Rows it can't read — someone marked OFF, a blank date — are listed so you can
   see exactly what was skipped.
4. **Import**.

**Then hand out the work:** on the Schedule tab pick the day and tap
**Hand out tasks**. Everyone on shift gets the time blocks that overlap their
hours, and it shows up on their phone under Today with the time on it.

Tap it again after a schedule change — it only ever adds what's missing, so it
can't double up.

**Names that don't match:** if Square writes someone as "D. Fox" and your team
has "Dee Fox", they show up as **not linked**. Tap the name, pick the person,
and the app remembers that spelling for future imports.

---

## Pushing this repo to GitHub

```bash
git remote -v                      # confirm the remote
git push -u origin main
```

## Day-to-day

- **Crew:** open the app → work the list → photo → done.
- **You:** Overview for the pulse of the day, Review to check photos and sign
  off, Reports → **Download CSV** for records.

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

**Someone joined the wrong team.** They can leave from **Me → Leave team**, then
join again with the right code.

**Screens error out right after signing in.** The database tables aren't there —
run `supabase/schema.sql` (step 2).

**Import says it can't read the dates or times.** Change the column dropdowns on
the import screen — the preview updates as you do. If your dates are day/month,
tick that box. Rows the app skipped are listed with the reason.

**Someone on the schedule shows "not linked".** Square spells their name
differently from their app account. Tap the name on the Schedule tab and pick
the person; it's remembered from then on.

**Handing out tasks assigned nothing.** Either nobody's shift overlaps a time
block's window, or everyone already has those tasks. The Schedule tab shows who
is on and how many tasks each has.

**A photo won't upload.** Check **Storage** shows a private bucket named
`task-photos`; if not, re-run the schema.

**"Your account does not have permission for that."** Row-level security doing
its job — that person is on a different team, or their access was turned off.

**I ran an older version of this schema.** Run `supabase/reset.sql` once, then
`supabase/schema.sql`. That clears the old tables — only do it while you have no
real data.

**The app looks stale after a deploy.** Fully close it and reopen; the service
worker picks up the new version on next launch.
