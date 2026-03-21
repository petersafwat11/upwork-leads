# Upwork Job Scanner

Scans Upwork RSS feeds hourly for relevant job listings based on your profile, scores them, and sends notifications.

## Features

- **RSS-based scanning** - No login, no scraping, ToS compliant
- **Aggressive filtering** - Hard rejects for low budget, bad keywords, too many proposals
- **Smart scoring** - Points for tech stack match, budget, recency
- **Proposal filtering** - Prefers jobs with fewer proposals, rejects 50+
- **Duplicate prevention** - Tracks sent links to avoid repeats
- **Smart scan windows** - Detects overlap between runs, avoids re-scanning
- **Dev mode** - Outputs to file instead of email when `NODE_ENV=dev`

## Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Create `.env` file:**

   ```bash
   copy .env.example .env
   ```

3. **Get your Upwork RSS URL:**

   - Go to Upwork > Find Work
   - Set up your search filters
   - Click "Save Search"
   - Click the RSS icon to get the feed URL
   - Add it to `.env` as `UPWORK_RSS_URL`

4. **Configure email (for production):**
   - Set `SMTP_*` and `EMAIL_*` variables in `.env`
   - For Gmail, use an App Password (not your regular password)

## Usage

### Development Mode (outputs to file)

```bash
npm run dev
```

- Runs a scan immediately
- Outputs results to `output/` folder
- No cron scheduling

### Production Mode (sends emails)

```bash
npm start
```

- Starts cron scheduler (every hour by default)
- Sends email notifications for matching jobs

### Manual Scan

```bash
npm run scan
```

## API Endpoints

- `GET /` - Status and last run info
- `GET /scan` - Trigger manual scan
- `GET /history` - View sent links history

## Filtering Rules

### Hard Rejects

- Budget < $500
- Contains reject keywords (WordPress, Webflow, Bubble, NFT, Crypto, etc.)
- Job older than 6 hours
- **50+ proposals**

### Proposal Tiers

| Proposals | Tier         | Bonus     |
| --------- | ------------ | --------- |
| 0-5       | Preferred    | +2 points |
| 5-10      | Good         | +1 point  |
| 10-15     | Acceptable   | 0         |
| 15-20     | Less Good    | 0         |
| 20-50     | Marginal     | 0         |
| 50+       | **REJECTED** | -         |

### Scoring (minimum 6 points to pass)

- +3: React, Next.js, Node, Express
- +2: PostgreSQL, Dashboard, Admin, SaaS
- +2: Budget >= $1000
- +1: Posted < 1 hour ago
- +1-2: Low proposal count bonus

## Data Files

Located in `data/` folder:

- `sent-links.json` - Tracks all links already sent (auto-cleans after 7 days)
- `run-history.json` - Tracks scan runs and windows (keeps last 168 runs)

## Output Files

Located in `output/` folder (dev mode only):

- `scan-YYYY-MM-DDTHH-MM-SS.txt` - Timestamped report
- `latest.txt` - Always contains the most recent scan

## Configuration

All thresholds configurable via environment variables:

| Variable          | Default     | Description           |
| ----------------- | ----------- | --------------------- |
| MIN_BUDGET        | 500         | Minimum fixed budget  |
| MIN_SCORE         | 6           | Minimum score to pass |
| MAX_JOB_AGE_HOURS | 6           | Maximum job age       |
| CRON_SCHEDULE     | `0 * * * *` | Hourly by default     |

## How Smart Scan Windows Work

1. First run: Scans last 6 hours
2. Subsequent runs: Scans from 5 minutes before last scan ended
3. If more than 6 hours since last run: Scans full 6 hours
4. Prevents re-scanning the same jobs
5. Small overlap (5 min) ensures no jobs are missed
