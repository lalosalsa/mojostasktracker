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

## 3. Turn the sign-in email into a 6-digit code

By default Supabase emails a magic *link*. A link opens in the phone's browser
instead of the installed app, so this app asks for a **code** instead — you just
have to tell Supabase to include one.

1. **Authentication** → **Emails** (older projects: *Email Templates*).
2. Select the **Magic Link** template.
3. Make sure the body contains `{{ .Token }}`. For example:

   ```html
   <h2>Your sign-in code</h2>
   <p>Enter this code in the app:</p>
   <h1 style="letter-spacing:8px">{{ .Token }}</h1>
   <p>It expires in 60 minutes. If you didn't ask to sign in, ignore this email.</p>
   ```

4. Save.

Also check **Authentication → Sign In / Providers → Email** is enabled. Leave
"Allow new users to sign up" **on** — new people land in a waiting room with no
access until you approve them, which is how your crew gets added.

## 4. Set up real email sending (do this before your crew uses it)

Supabase's built-in email service is for testing and is rate limited to a
**handful of messages per hour** — with a crew signing in, that runs out fast and
people get locked out.

1. Create a free account with an email provider — [Resend](https://resend.com),
   SendGrid, Postmark or similar — and get SMTP credentials.
2. In Supabase: **Project Settings** → **Authentication** → **SMTP Settings** →
   enable custom SMTP and paste the host, port, username, password and a sender
   address you own.
3. While you're there, raise **Rate Limits → Emails per hour** to something that
   fits your crew size.

Skip this and sign-in emails will start failing once a few people try at once.

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

## 7. Point Supabase at your live URL

Back in Supabase: **Authentication** → **URL Configuration**.

- **Site URL**: `https://your-app.vercel.app`
- **Redirect URLs**: add `https://your-app.vercel.app/**`

## 8. Claim the manager account

Open your Vercel URL and sign in with **your own email** first.

**The first person to sign in becomes the manager.** Do this before anyone else
touches the link.

## 9. Add your crew

1. Go to the **Team** tab → **Add a team member** → enter their work email.
2. Send them the app link.
3. They enter that email, type the code from their inbox, and they're in.

Anyone who signs in *without* being added first waits in a holding screen until
you approve them from the Team tab — so the link is safe to share in a group
chat.

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

**"That code expired" / no email arrives.** You're likely hitting the built-in
email rate limit — do step 4. Also check the spam folder.

**Someone is stuck on "Almost there".** They signed up before you added them.
Approve them in **Team**.

**A photo won't upload.** The bucket comes from the SQL in step 2. Check
**Storage** shows a private bucket named `task-photos`; if not, re-run the file.

**"Your account does not have permission for that."** That's row-level security
doing its job — the person is either pending or trying to touch someone else's
task.

**I signed in first but I'm not the manager.** Someone beat you to it. In
Supabase, **Table Editor** → `profiles`, set your row's `role` to `admin` and
`status` to `active`.

**The app looks stale after a deploy.** Fully close it and reopen; the service
worker picks up the new version on next launch.
