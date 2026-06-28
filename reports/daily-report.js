/**
 * Daily lead-quality report — heuristic, deterministic, $0.
 *
 * Reads the JSONL lead logs and produces:
 *   1. A full markdown report (data/reports/report-YYYY-MM-DD.md) for review
 *      in Claude Code (run /daily-review) or by eye.
 *   2. A compact summary posted to Slack each morning.
 *
 * It does NOT make quality judgments itself — it surfaces the candidates:
 *   - near-misses (passed hard filters, scored just under threshold) and
 *     borderline hard-rejects (budget just low, too old) = likely GOOD leads
 *     we dropped (false negatives).
 *   - the full sent list = leads to eyeball for OUT-OF-SCOPE sends
 *     (false positives).
 * The actual "is this good/bad" call is made during the daily review.
 */

const fs = require("fs");
const path = require("path");
const config = require("../config");
const leadLogger = require("./lead-logger");

function ensureReportsDir() {
  if (!fs.existsSync(config.paths.reportsDir)) {
    fs.mkdirSync(config.paths.reportsDir, { recursive: true });
  }
}

function pct(n, total) {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

function fmtBudget(rec) {
  if (rec.budgetType === "hourly") {
    if (rec.hourlyRange) return `$${rec.hourlyRange.min}-${rec.hourlyRange.max}/hr`;
    return "hourly";
  }
  if (rec.budget) return `$${rec.budget}`;
  return "n/a";
}

function fmtProposals(rec) {
  if (!rec.proposals) return "?";
  const { min, max } = rec.proposals;
  if (min === max) return `${min}`;
  if (max === 999) return `${min}+`;
  return `${min}-${max}`;
}

/** Count by a key function into a sorted [ [key, count], ... ] array. */
function countBy(records, keyFn) {
  const map = {};
  for (const r of records) {
    const k = keyFn(r);
    if (k === null || k === undefined) continue;
    map[k] = (map[k] || 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

/** Build the aggregate stats object for a set of records. */
function analyze(records) {
  const sent = records.filter((r) => r.disposition === "sent");
  const below = records.filter((r) => r.disposition === "below_threshold");
  const hard = records.filter((r) => r.disposition === "hard_rejected");

  const nearMisses = below
    .filter((r) => r.nearMiss)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  // Borderline hard-rejects most likely to be good leads we dropped.
  const budgetRejects = hard
    .filter((r) => r.rejectCategory === "budget")
    .sort((a, b) => (b.budget || 0) - (a.budget || 0));
  const ageRejects = hard.filter((r) => r.rejectCategory === "too_old");
  const proposalRejects = hard.filter(
    (r) => r.rejectCategory === "too_many_proposals"
  );

  // Score histogram across everything that was scored (sent + below).
  const scored = [...sent, ...below].filter((r) => typeof r.score === "number");
  const histogram = {};
  for (const r of scored) {
    const bucket = Math.floor(r.score / 2) * 2; // 0-1,2-3,4-5...
    histogram[bucket] = (histogram[bucket] || 0) + 1;
  }

  return {
    total: records.length,
    sent,
    below,
    hard,
    nearMisses,
    budgetRejects,
    ageRejects,
    proposalRejects,
    rejectCategories: countBy(hard, (r) => r.rejectCategory),
    rejectKeywords: countBy(
      hard.filter((r) => r.rejectCategory === "reject_keyword"),
      (r) => r.matchedTerm
    ),
    sentLocations: countBy(sent, (r) => r.clientLocation),
    histogram,
  };
}

function jobLine(rec, { showScore = true, showReason = false } = {}) {
  const parts = [];
  parts.push(`**${rec.title || "(no title)"}**`);
  if (showScore && typeof rec.score === "number") {
    parts.push(`score ${rec.score}/${rec.minScore}`);
  }
  parts.push(fmtBudget(rec));
  if (rec.clientLocation) parts.push(rec.clientLocation);
  parts.push(`${rec.proposals ? fmtProposals(rec) + " props" : ""}`.trim());
  if (rec.ageMinutes != null) parts.push(`${rec.ageMinutes}m old`);
  let line = `- ${parts.filter(Boolean).join(" · ")}`;
  if (rec.link) line += `\n  ${rec.link}`;
  if (showReason && rec.reason) line += `\n  _${rec.reason}_`;
  if (showScore && rec.scoreBreakdown) {
    const b = rec.scoreBreakdown;
    line += `\n  breakdown: kw ${b.keywords || 0}, stack ${b.stackDepth || 0}, specialty ${b.specialty || 0}, budget ${b.budget || 0}, recency ${b.recency || 0}, props ${b.proposals || 0}, client ${b.client || 0}, desc ${b.description || 0}, urgency ${b.urgency || 0}`;
  }
  return line;
}

function buildMarkdown({ day, hours, recent, weekly }) {
  const r = analyze(recent);
  const w = analyze(weekly);
  const L = [];

  L.push(`# Upwork Lead Quality Report — ${day}`);
  L.push("");
  L.push(`_Window: last ${hours}h. Generated ${new Date().toISOString()}._`);
  L.push("");

  // ---- Funnel ----
  L.push(`## 1. Funnel (last ${hours}h)`);
  L.push("");
  L.push(`| Outcome | Count | Share |`);
  L.push(`|---|---|---|`);
  L.push(`| Unique jobs seen | ${r.total} | 100% |`);
  L.push(`| ✅ Sent to Slack | ${r.sent.length} | ${pct(r.sent.length, r.total)} |`);
  L.push(`| ⚠️ Below score threshold | ${r.below.length} | ${pct(r.below.length, r.total)} |`);
  L.push(`| ❌ Hard-rejected | ${r.hard.length} | ${pct(r.hard.length, r.total)} |`);
  L.push("");

  // ---- Hard reject breakdown ----
  L.push(`## 2. Why jobs were hard-rejected`);
  L.push("");
  if (r.rejectCategories.length === 0) {
    L.push("_None._");
  } else {
    L.push(`| Filter | Count |`);
    L.push(`|---|---|`);
    for (const [cat, n] of r.rejectCategories) L.push(`| ${cat} | ${n} |`);
  }
  L.push("");
  if (r.rejectKeywords.length) {
    L.push(`**Top reject keywords that triggered:** ${r.rejectKeywords
      .slice(0, 15)
      .map(([k, n]) => `\`${k}\` (${n})`)
      .join(", ")}`);
    L.push("");
  }

  // ---- Score histogram ----
  L.push(`## 3. Score distribution (scored jobs)`);
  L.push("");
  L.push("```");
  const buckets = Object.keys(r.histogram)
    .map(Number)
    .sort((a, b) => a - b);
  const maxCount = Math.max(1, ...Object.values(r.histogram));
  for (const b of buckets) {
    const n = r.histogram[b];
    const bar = "█".repeat(Math.round((n / maxCount) * 30));
    const marker = b >= config.thresholds.minScore ? " <- sent zone" : "";
    L.push(`${String(b).padStart(2)}-${b + 1}: ${bar} ${n}${marker}`);
  }
  L.push("```");
  L.push(`_Threshold to send: score ≥ ${config.thresholds.minScore} (and ≥1 keyword match)._`);
  L.push("");

  // ---- FALSE-NEGATIVE candidates ----
  L.push(`## 4. 🔎 Possible GOOD leads we DROPPED (review these)`);
  L.push("");
  L.push(`### 4a. Near-misses — passed all hard filters, scored just under threshold`);
  L.push(`_Score within ${config.logging.nearMissWindow} of threshold, with keyword relevance. Top candidates for raising/retuning scoring._`);
  L.push("");
  if (r.nearMisses.length === 0) {
    L.push("_None._");
  } else {
    for (const rec of r.nearMisses.slice(0, 25)) {
      L.push(jobLine(rec, { showScore: true }));
    }
  }
  L.push("");
  L.push(`### 4b. Rejected only for low budget (highest first)`);
  L.push(`_Min budget is $${config.thresholds.minBudget}. If good fits appear here, consider lowering it._`);
  L.push("");
  if (r.budgetRejects.length === 0) {
    L.push("_None._");
  } else {
    for (const rec of r.budgetRejects.slice(0, 15)) {
      L.push(jobLine(rec, { showScore: false, showReason: true }));
    }
  }
  L.push("");
  L.push(`### 4c. Rejected only for being too old`);
  L.push(`_Max age is ${config.thresholds.maxJobAgeMinutes}m. High volume here may mean scan interval/lookback is too tight._`);
  L.push(`Count: **${r.ageRejects.length}**`);
  L.push("");
  L.push(`### 4d. Rejected for too many proposals`);
  L.push(`Count: **${r.proposalRejects.length}** (limit: ${config.proposalLimits.reject}+)`);
  L.push("");

  // ---- FALSE-POSITIVE review ----
  L.push(`## 5. ✅ Leads we SENT (review for out-of-scope / false positives)`);
  L.push(`_Check each is in scope: React/Next/Node/Express/Postgres web work; client NOT India/Pakistan/Bangladesh/Vietnam; no country-lock excluding Egypt._`);
  L.push("");
  if (r.sent.length === 0) {
    L.push("_Nothing sent in this window._");
  } else {
    for (const rec of r.sent.sort((a, b) => (b.score || 0) - (a.score || 0))) {
      const skills = (rec.skills || []).slice(0, 8).join(", ");
      L.push(jobLine(rec, { showScore: true }));
      if (skills) L.push(`  skills: ${skills}`);
    }
  }
  L.push("");

  // ---- 7 day trend ----
  L.push(`## 6. 7-day trend`);
  L.push("");
  L.push(`| Metric | 7-day total |`);
  L.push(`|---|---|`);
  L.push(`| Unique jobs seen | ${w.total} |`);
  L.push(`| Sent | ${w.sent.length} |`);
  L.push(`| Below threshold | ${w.below.length} |`);
  L.push(`| Hard-rejected | ${w.hard.length} |`);
  L.push(`| Near-misses | ${w.nearMisses.length} |`);
  L.push("");
  if (w.rejectCategories.length) {
    L.push(`**7-day reject reasons:** ${w.rejectCategories
      .map(([c, n]) => `${c} (${n})`)
      .join(", ")}`);
    L.push("");
  }

  // ---- Footer ----
  L.push("---");
  L.push("");
  L.push(
    `➡️ **Next step:** run \`/daily-review\` in Claude Code on this repo to deeply analyze the dropped/sent leads above and apply tuning to filters/scoring/config.`
  );
  L.push("");

  return { markdown: L.join("\n"), stats: r };
}

/** Build the short Slack summary text from the 24h stats. */
function buildSlackSummary({ day, stats }) {
  const r = stats;
  const lines = [];
  lines.push(`*Upwork Lead Report — ${day}*`);
  lines.push(
    `Seen *${r.total}* · Sent *${r.sent.length}* · Below threshold *${r.below.length}* · Hard-rejected *${r.hard.length}*`
  );
  if (r.nearMisses.length) {
    lines.push(`\n:mag: *${r.nearMisses.length} near-miss(es)* — possible good leads dropped:`);
    for (const rec of r.nearMisses.slice(0, 3)) {
      lines.push(
        `• <${rec.link}|${(rec.title || "job").slice(0, 70)}> — score ${rec.score}/${rec.minScore}`
      );
    }
  }
  if (r.budgetRejects.length) {
    lines.push(`:moneybag: ${r.budgetRejects.length} dropped for low budget.`);
  }
  lines.push(
    `\nFull report saved on VPS: \`data/reports/report-${day}.md\`. Run \`/daily-review\` for deep analysis + tuning.`
  );
  return lines.join("\n");
}

async function postToSlack(text) {
  const webhook = config.slack.webhookUrl;
  if (!webhook) {
    console.log("Daily report: no Slack webhook configured, skipping post.");
    return false;
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`Daily report Slack error (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Daily report Slack send failed:", err.message);
    return false;
  }
}

/**
 * Generate the report, save markdown to disk, and post a Slack summary.
 * @param {object} opts
 * @param {number} opts.hours  lookback for the main report window (default 24)
 * @param {boolean} opts.post  override config.postReportToSlack
 */
async function generateAndDeliverReport({ hours = 24, post } = {}) {
  ensureReportsDir();

  const recent = leadLogger.readRecordsSince(hours);
  const weekly = leadLogger.readRecordsSince(24 * 7);
  const day = leadLogger.dateStr();

  const { markdown, stats } = buildMarkdown({ day, hours, recent, weekly });

  const reportPath = path.join(config.paths.reportsDir, `report-${day}.md`);
  fs.writeFileSync(reportPath, markdown);
  console.log(`Daily report written: ${reportPath}`);

  let slackPosted = false;
  const shouldPost = post !== undefined ? post : config.logging.postReportToSlack;
  if (shouldPost) {
    slackPosted = await postToSlack(buildSlackSummary({ day, stats }));
  }

  return {
    reportPath,
    slackPosted,
    counts: {
      seen: stats.total,
      sent: stats.sent.length,
      belowThreshold: stats.below.length,
      hardRejected: stats.hard.length,
      nearMisses: stats.nearMisses.length,
    },
  };
}

module.exports = {
  generateAndDeliverReport,
  buildMarkdown,
  analyze,
};
