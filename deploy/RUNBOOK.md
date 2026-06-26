# Upwork Scanner — VPS deployment runbook

Runs as a second project alongside the restaurant stack on the same Contabo VPS.
The host (deploy user, Docker, UFW, swap) was already provisioned by the
restaurant's `bootstrap.sh` — this project only adds its own folder + containers.

- **VPS:** `207.180.217.159`, user `deploy`
- **Project dir:** `/opt/upwork-scanner`
- **Containers:** `scanner` (built from source) + `flaresolverr`
- **Public access:** none. Internal-only; matches are pushed to Slack.

```bash
ssh deploy@207.180.217.159
cd /opt/upwork-scanner
```

---

## First-time setup (do this once on the VPS)

```bash
# 1. Clone the repo into /opt
git clone https://github.com/petersafwat11/upwork-leads.git /opt/upwork-scanner
cd /opt/upwork-scanner

# 2. Create the .env (NOT in git — holds your Slack webhook + secrets)
cp .env.example .env
nano .env          # set SLACK_WEBHOOK_URL, UPWORK_RSS_URL, SMTP_*, thresholds
chmod 600 .env

# 3. Build + start
docker compose up -d --build

# 4. Confirm both containers are up and the scanner booted cleanly
docker compose ps
docker compose logs --tail=50 scanner
```

You should see the scanner log its config and `Cron scheduled: ...`.
(Note: in production it only scans 12:00–23:59 UTC — outside that window it
logs "Outside operating hours" and skips, which is expected.)

### Enable auto-deploy (optional but recommended)

Add these secrets to the GitHub repo
(**Settings → Secrets and variables → Actions**) so every push to `main`
redeploys automatically via `.github/workflows/deploy.yml`:

| Secret | Value |
| ------ | ----- |
| `VPS_HOST` | `207.180.217.159` |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | the `deploy` user's **private** SSH key |
| `VPS_PORT` | `22` (optional) |

Until these exist the workflow will fail — that's fine, you can always deploy
manually with the commands below.

---

## Deploy a change

**Auto:** push to `main` → GitHub Action SSHes in and runs the steps below.

**Manual (from the VPS):**

```bash
cd /opt/upwork-scanner
git pull --ff-only origin main
docker compose up -d --build
docker image prune -f
```

---

## View logs

```bash
docker compose logs -f --tail=200 scanner
docker compose logs -f --tail=200 flaresolverr
```

## Trigger a scan immediately (bypass the cron + operating-hours wait)

The status endpoints aren't exposed publicly, so hit them from inside the box:

```bash
docker compose exec scanner node -e "require('./index.js').runScan()"
```

Or check current status / today's sent count:

```bash
docker compose exec scanner node -e "fetch('http://127.0.0.1:3000/').then(r=>r.json()).then(console.log)"
```

## Restart / stop

```bash
docker compose restart scanner
docker compose down            # stop everything (data volume is preserved)
docker compose up -d --build   # start again
```

---

## Persistent data

`sent-links.json` and `run-history.json` live in the `scanner-data` named
volume (`/app/data` in the container), so they survive redeploys and the
scanner won't re-send leads after every push.

```bash
docker volume inspect upwork-scanner_scanner-data
```

**Caveat:** the volume is seeded from the image's `data/` on first creation,
which includes `data/tracker.js`. If you ever change `tracker.js` logic, the
old copy in the volume shadows it. To pick up the new code:

```bash
docker compose down
docker volume rm upwork-scanner_scanner-data   # WARNING: also clears sent-links history
docker compose up -d --build
```

(Only needed for `tracker.js` *code* changes — normal config lives in `.env`.)

---

## Change config (Slack webhook, thresholds, search URL)

Everything tunable is in `.env`. Edit and restart — no rebuild needed:

```bash
nano /opt/upwork-scanner/.env
docker compose up -d   # recreates the container with the new env
```

---

## Troubleshooting

- **No Slack messages:** check `SLACK_WEBHOOK_URL` in `.env`, then
  `docker compose logs --tail=100 scanner` for send errors. Remember scans
  only run 12:00–23:59 UTC and only for jobs younger than `MAX_JOB_AGE_MINUTES`.
- **Fetch failures / Cloudflare:** check `docker compose logs flaresolverr`.
  Restart it with `docker compose restart flaresolverr`.
- **Container keeps restarting:** `docker compose logs --tail=100 scanner` —
  usually a missing/invalid `.env`.

## Disk / health

```bash
docker compose ps
docker stats --no-stream
df -h
```
