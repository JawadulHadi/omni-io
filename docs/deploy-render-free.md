# Free hosting without a credit card: Render + Neon + Redis Cloud

Three free plans, none of which asks for a credit card:

| Service | Runs | Free plan |
| --- | --- | --- |
| [Render](https://render.com) | Omni.io itself: the API, the console and the ingestion worker in one container ([`deploy/render.Dockerfile`](../deploy/render.Dockerfile)) | 512 MB RAM, 0.1 CPU, 750 hours a month. Sleeps after 15 minutes without visitors |
| [Neon](https://neon.com) | Postgres with pgvector | 0.5 GB of storage, 100 compute-hours a month. Sleeps after 5 minutes idle and wakes on the next query |
| [Redis Cloud](https://redis.io/try-free/) | Redis (queue and rate limits) | 30 MB, 30 connections, 100 operations a second |

**The trade-off:** when nobody has visited for 15 minutes, Render puts the service to sleep. The next visitor waits about a minute while it wakes up; after that it's normal speed. Your data is safe throughout, because it lives in Neon and Redis Cloud.

Expect about 30 minutes for the whole setup.

## 1. Neon: the database

1. Sign up at [neon.com](https://neon.com) with GitHub or Google.
2. Create a project. Pick the region closest to where Render will run (Frankfurt, or US East/West).
3. Open **Connect** and turn **Connection pooling off**. Migrations need a direct connection.
4. Copy the connection string. It looks like `postgresql://neondb_owner:…@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
   - Note the region in the host name (for example `us-east-2`). Render should run in the matching region: `render.yaml` uses `ohio`, which sits next to Neon's `us-east-2`. If your Neon project is elsewhere, change `region` (Render offers `oregon`, `ohio`, `virginia`, `frankfurt`, `singapore`).
   - Keep it somewhere private. It's the database owner's password.

You don't need to create tables, users or extensions. Omni.io's migrations do all of it on first start, including the restricted `omniio_app` role the app connects as.

## 2. Redis Cloud: the queue

1. Sign up at [redis.io/try-free](https://redis.io/try-free/) and create a **Free** database (30 MB) in the same region as before.
2. In the database's **Configuration**, if the eviction policy can be changed, set it to `noeviction`. The job queue expects that; with this app's tiny data it rarely matters.
3. From **Connect**, note the public endpoint (`host:port`) and the password of the `default` user.
4. Build the URL from them: `redis://default:<password>@<host>:<port>`

## 3. Optional: a Gemini API key

For real AI answers, create a free key at [Google AI Studio](https://aistudio.google.com/apikey); its free tier is rate-limited. Without a key, Omni.io gives offline demo answers.

## 4. Render: the app

1. Sign up at [render.com](https://render.com) with your GitHub account.
2. Choose **New → Blueprint**, then pick the `omni-io` repository (branch `main`). Render reads [`render.yaml`](../render.yaml).
3. Fill in the three values it asks for:
   - `DATABASE_MIGRATOR_URL`: the Neon string from step 1
   - `REDIS_URL`: the URL from step 2
   - `GEMINI_API_KEY`: your key, or leave it empty
4. Click **Apply**.

The first build takes about 10 minutes. When the service shows **Live**, open its URL (`https://omniio-xxxx.onrender.com`). Render generated `JWT_SECRET` and `APP_DB_PASSWORD` for you.

## 5. Create your account, then close sign-up

1. Open your URL and create an account. You become the owner of its workspace.
2. In Render, open the service's **Environment**, set `ALLOW_SIGNUP` to `false`, and save. It redeploys.
3. Invite teammates from **Members → Invite someone**.

**Without a Gemini key**, also lower the similarity floor so the demo answers find your documents: **Playground → Ladder settings → Similarity floor 0.1**. The offline provider's word-matching vectors score lower than real embeddings.

## Keeping it awake (optional)

To skip the one-minute wake-up, have a free uptime monitor (UptimeRobot, Better Stack, cron-job.org) request `https://<your URL>/health/live` every 10 minutes.

- One always-on service uses about 744 of Render's 750 free hours a month, so this only works for one free service.
- Use `/health/live`, **not** `/health`. `/health` queries the database every time, which would keep Neon from sleeping and use up its 100 free compute-hours.

## Upgrading

Every push to `main` redeploys automatically. Migrations run on start.

## Good to know

- **Render may ask a few accounts for a card.** Some new accounts get a one-time card check to prevent abuse. If that happens to you, the alternative is running the [Docker Compose stack](deployment.md) on your own computer and exposing it with a tunnel.
- **Sizing.** Omni.io uses about 100 MB of the 512 MB, so it fits comfortably. PDFs are parsed one at a time with a 128 MB cap; very large PDFs on 0.1 CPU can take up to 2 minutes.
- **Rate limits by visitor IP.** These use `TRUST_PROXY=3`, the number of proxies Render users report in front of the app. If everyone seems to share one rate limit, adjust it.
- **Storage.** Neon's 0.5 GB holds the text and vectors of a few thousand pages. The **Answer audit** keeps questions for 90 days (`ANSWER_RETENTION_DAYS`).
- **Backups.** Neon keeps a short restore window on the free plan. For anything important, export regularly: `pg_dump "<your Neon string>" > backup.sql`.
