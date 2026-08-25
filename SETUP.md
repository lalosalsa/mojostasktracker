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

## 3. Make Supabase send codes instead of links

**This is the step that trips everyone up.** Supabase sends a magic *link* by
default, and a link opens the phone's browser instead of the installed app. The
app asks for a 6-digit code — you just have to put the code in the email.

The catch: **Supabase uses two different templates**, and you need `{{ .Token }}`
in *both*, or new sign-ups still get a link.

| Who gets it | Template to edit |
|---|---|
| Someone signing up for the first time | **Confirm signup** |
| Someone signing back in later | **Magic Link** |

1. **Authentication** → **Emails** (older projects: *Email Templates*).
2. Open **Confirm signup**, and replace the body with:

   ```html
   <h2>Your code</h2>
   <p>Enter this in the app to finish signing up:</p>
   <h1 style="letter-spacing:8px;font-family:monospace">{{ .Token }}</h1>
   <p>It expires in 60 minutes. If you didn't ask for it, ignore this email.</p>
   ```

3. Open **Magic Link** and use the same body (change the wording to "Enter this
   in the app to sign in" if you like).
4. Save both.

Then check **Authentication → Sign In / Providers → Email** is enabled, and leave
**Allow new users to sign up** on — that's how your crew creates their accounts.
Getting into *your* team still requires the team code from step 8.

> Already sent yourself a link email while testing? Fix the templates, then
> request a new code — old emails keep the old format.

## 4. Set up real email sending (do this before your crew uses it)

Supabase's built-in email service is for testing and is rate limited to a
**handful of messages per hour** — with a crew signing up, that runs out fast and
people get locked out.

1. Create a free account with an email provider — [Resend](https://resend.com),
   SendGrid, Postmark or similar — and get SMTP credentials.
2. In Supabase: **Project Settings** → **Authentication** → **SMTP Settings** →
   enable custom SMTP and paste the host, port, username, password and a sender
   address you own.
3. While you're there, raise **Rate Limits → Emails per hour** to something that
   fits your crew size.

Skip this and the codes will stop arriving once a few people sign up at once.

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

Open your Vercel URL and tap **Create an account**. Enter your name and email,
type the 6-digit code from your inbox, then choose **Create a new team** and name
your business.

You're the manager. The app shows you a **6-character crew code** — that's what
your crew types to join. You can see it again any time under **Team**.

## 9. Get your crew in

Send them the app link. Each person taps **Create an account**, enters their
name and email, types their emailed code, then chooses **I have a team code** and
types your crew code.

That's it — they're on your team and can start logging work.

Two things worth knowing:

- **Team** → **Share** copies a ready-made invite (link + code) you can paste
  into a group text.
- There's a separate **manager code** under Team, for anyone who should also
  see everyone's work and sign off on photos. Only share that one deliberately.
- If a code gets out, **New code** issues a fresh one. People already on the
  team stay on it.

## 10. Get it onto their phones

Tell each person to open the link in their phone browser and:

- **iPhone (Safari):** Share button → **Add to Home Screen** → Add.
- **Android (Chrome):** ⋮ menu → **Install app** (or *Add to Home screen*).

It then opens full-screen from the home screen icon, like any other app, and
stays signed in.

## 11. Set up the daily checklist (optional)

**More → Recurring tasks** — add the jobs that happen every day or every week.
They appear on the crew's Today screen automatically each morning.

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

**The email has a link, not a code.** Both templates need `{{ .Token }}` — see
step 3. The *Confirm signup* template is the one people forget, so first-time
sign-ups keep getting links.

**No email arrives at all.** You're likely hitting the built-in email rate limit
— do step 4. Also check spam.

**"That team code does not match any team."** Codes are 6 characters and skip
easily-confused letters (no O, I or L — those are zero, one and one). Read it
off the Team screen and re-send it.

**Someone joined the wrong team.** They can leave from **Me → Leave team**, then
join again with the right code.

**Screens error out right after signing in.** The database tables aren't there —
run `supabase/schema.sql` (step 2).

**A photo won't upload.** Check **Storage** shows a private bucket named
`task-photos`; if not, re-run the schema.

**"Your account does not have permission for that."** Row-level security doing
its job — that person is on a different team, or their access was turned off.

**I ran an older version of this schema.** Run `supabase/reset.sql` once, then
`supabase/schema.sql`. That clears the old tables — only do it while you have no
real data.

**The app looks stale after a deploy.** Fully close it and reopen; the service
worker picks up the new version on next launch.
