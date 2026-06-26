---
description: Analyze the day's Upwork lead logs — find good leads we wrongly dropped and bad leads we wrongly sent, then propose & apply tuning.
---

You are doing the daily lead-quality review for this Upwork scanner. Your job is to
turn the raw logs into concrete code changes that send MORE good leads and FEWER bad ones.

## The user's scope (the definition of a "good lead")
- Stack: React, Next.js, Node.js, Express, PostgreSQL, Tailwind, Supabase — full-stack web work.
- GOOD: web apps, dashboards, SaaS, MVPs, internal tools, APIs, full-stack/frontend/backend roles.
- OUT OF SCOPE (these are BAD if they were sent):
  - Client located in India, Pakistan, Bangladesh, or Vietnam.
  - Country-locked jobs that exclude Egypt (e.g. "US only", "must be UK based").
  - WordPress / Webflow / Shopify / Flutter / mobile-only / .NET / Laravel / Django / PHP / Vue / Angular-only.
  - Pure AI/ML/Python/data work with no web-dev component.
  - Design-only, copywriting, marketing, ops, VA roles.
- The user prefers FEWER-BUT-BETTER matches over volume. Favor precision; don't flood Slack.

## Steps

1. **Read the data.** Look at the latest report and the raw logs:
   - `data/reports/report-<today>.md` (run `node scripts/generate-report.js` first if missing/stale).
   - Raw records: `data/logs/jobs-<today>.jsonl` (and prior days for trend). Each line is one job — see `data/logs/ANALYSIS_GUIDE.md` for the schema and disposition meanings.

2. **Hunt FALSE NEGATIVES (good leads we dropped).** Focus on, in order:
   - `nearMiss: true` records (below_threshold, score near the cutoff, has keyword relevance).
   - hard-rejected with `rejectCategory` of `budget`, `too_old`, `too_many_proposals`, `conditional_keyword`, `reject_keyword`.
   For each, judge against the scope above: was it actually a good React/Next/Node lead? If yes, diagnose WHY it was dropped (which scoring component under-counted, which keyword list is too aggressive, which threshold too tight).

3. **Hunt FALSE POSITIVES (bad leads we sent).** Go through every `disposition: "sent"` record and check it against the OUT-OF-SCOPE list. Flag any that slipped through and diagnose how (missing reject keyword? location not in red-flag list? scoring rewarded the wrong thing?).

4. **Diagnose root causes, not symptoms.** Tie each misclassification to a specific place in code:
   - `config/keywords.js` — reject lists, scoring keyword tiers/points.
   - `config/locations.js` — preferred / red-flag locations.
   - `filters/hard-reject.js` — filter logic and order.
   - `scoring/scorer.js` — point weights and thresholds.
   - `config/index.js` / `.env` — `MIN_SCORE`, `MIN_BUDGET`, `MAX_JOB_AGE_MINUTES`, proposal limits.
   Remember tuning thresholds live in `.env` on the VPS, not just config defaults — propose `.env` changes where a threshold is the lever.

5. **Propose changes.** Present a short, prioritized list: for each, the exact file+edit, the leads it fixes, and the risk (could it now let bad leads in / drop good ones?). Prefer surgical edits. Be conservative — one bad keyword removal can flood Slack.

6. **Apply on approval.** After the user approves, make the edits. For `.env` threshold changes, tell the user the exact line to change on the VPS (don't assume the local `.env` matches prod).

7. **Record learnings.** If a tuning decision reflects a durable preference (e.g. "always reject X", "Y is in scope after all"), save it to memory so future reviews are consistent.

Keep the output focused: lead with the misclassifications found and the recommended fixes. Don't dump the whole log.
