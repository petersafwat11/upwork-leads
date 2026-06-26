# Lead Logs — Analysis Guide

This folder holds the raw, deduped record of **every unique job the scanner saw**,
so we can review what was sent, what was dropped, and tune the system.

## Files
- `jobs-YYYY-MM-DD.jsonl` — one JSON object per line, one line per unique job
  (deduped by link). Daily rotation. Pruned after `LOG_RETENTION_DAYS` (default 30).
- `.seen.json` — internal dedup map (link → last disposition + time). Don't edit.
- `../reports/report-YYYY-MM-DD.md` — the generated heuristic report.

## Disposition (the outcome for each job)
| value | meaning |
|---|---|
| `sent` | Passed every filter + scoring, delivered to Slack. **Review for false positives.** |
| `below_threshold` | Passed all hard filters but scored under `minScore`. Source of near-misses. |
| `hard_rejected` | Killed by a hard filter. See `rejectCategory`. |

A job is logged once per dedup window; if its outcome later improves
(e.g. `below_threshold` → `sent`) the transition is logged again.

## `rejectCategory` (only set when `hard_rejected`)
`title`, `reject_skill`, `location_restriction`, `already_hired`,
`too_many_proposals`, `reject_keyword`, `conditional_keyword`,
`red_flag_phrase`, `location`, `budget`, `too_old`.

## Record fields
| field | notes |
|---|---|
| `ts` | when logged (ISO) |
| `disposition` / `rejectCategory` / `matchedTerm` / `reason` | outcome + why |
| `score` / `minScore` / `scorePassed` / `nearMiss` | scoring summary |
| `scoreBreakdown` | per-component points: keywords, stackDepth, budget, recency, proposals, client, description, urgency, total |
| `topScoreReasons` | human-readable scoring lines |
| `proposalTier` / `proposals` | proposal competition |
| `budget` / `budgetType` / `hourlyRange` | pay |
| `clientLocation` / `clientRating` / `clientTotalSpent` / `isContractToHire` | client |
| `locationRestrictions` | geo restrictions on the job |
| `skills` | skill tags |
| `pubDate` / `ageMinutes` | freshness |
| `descriptionLength` / `description` | content (snippet, truncated) |

## Quick queries (PowerShell / bash with jq)

```bash
# What got sent today
grep '"disposition":"sent"' jobs-$(date +%F).jsonl | jq -r '.title + " | " + (.score|tostring)'

# Near-misses (good leads we may have dropped)
grep '"nearMiss":true' jobs-$(date +%F).jsonl | jq -r '.title + " | score " + (.score|tostring) + " | " + .link'

# Count rejections by reason today
grep '"disposition":"hard_rejected"' jobs-$(date +%F).jsonl | jq -r '.rejectCategory' | sort | uniq -c | sort -rn
```

## The daily workflow
1. `node scripts/generate-report.js` (or wait for the morning cron / `GET /report`).
2. Read `../reports/report-<today>.md`.
3. Run `/daily-review` in Claude Code → it finds misclassifications and proposes tuning.
