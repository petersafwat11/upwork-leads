/**
 * Lead logger — append-only, deduped, $0, no external dependencies.
 *
 * Every UNIQUE job the scanner sees (deduped by link) is written once to a
 * daily JSONL file: data/logs/jobs-YYYY-MM-DD.jsonl. Each record carries a
 * `disposition` describing what happened to it:
 *
 *   - "sent"             -> passed everything and was sent to Slack
 *   - "below_threshold"  -> passed all hard filters but scored under minScore
 *   - "hard_rejected"    -> killed by a hard filter (see rejectCategory)
 *
 * The full job data is captured so a daily review (heuristic report or Claude
 * Code) can hunt false negatives (good leads we dropped) and false positives
 * (bad leads we sent) without having to re-derive anything.
 *
 * Dedup: the same job appears in many overlapping scans (10-min cron, 15-min
 * lookback). A small seen-map (data/logs/.seen.json) ensures each link is
 * logged once per dedup window — unless its disposition changes (e.g. it was
 * below_threshold and is later sent), in which case the transition is logged.
 */

const fs = require("fs");
const path = require("path");
const config = require("../config");

// Higher number = "better" outcome. Used to log meaningful transitions only.
const DISPOSITION_RANK = {
  hard_rejected: 0,
  below_threshold: 1,
  sent: 2,
};

function ensureDirs() {
  if (!fs.existsSync(config.paths.logsDir)) {
    fs.mkdirSync(config.paths.logsDir, { recursive: true });
  }
}

/** Local-time YYYY-MM-DD for a Date (used for daily file rotation). */
function dateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function logFilePath(d = new Date()) {
  return path.join(config.paths.logsDir, `jobs-${dateStr(d)}.jsonl`);
}

function loadSeen() {
  try {
    if (!fs.existsSync(config.paths.logSeenFile)) return {};
    return JSON.parse(fs.readFileSync(config.paths.logSeenFile, "utf8"));
  } catch (err) {
    console.error("lead-logger: could not read seen map:", err.message);
    return {};
  }
}

function saveSeen(seen) {
  try {
    fs.writeFileSync(config.paths.logSeenFile, JSON.stringify(seen));
  } catch (err) {
    console.error("lead-logger: could not write seen map:", err.message);
  }
}

/** Drop seen entries older than the dedup window so the map stays small. */
function pruneSeen(seen) {
  const cutoff =
    Date.now() - config.logging.dedupWindowHours * 60 * 60 * 1000;
  for (const link of Object.keys(seen)) {
    if (new Date(seen[link].loggedAt).getTime() < cutoff) {
      delete seen[link];
    }
  }
}

function safeNumber(n) {
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
}

function ageMinutes(job) {
  if (!job.pubDate) return null;
  const t =
    job.pubDate instanceof Date
      ? job.pubDate.getTime()
      : new Date(job.pubDate).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((Date.now() - t) / 60000);
}

/** Build one flat, review-friendly JSONL record from a job + its disposition. */
function buildRecord(job, disposition) {
  const filter = job.filterResult || {};
  const score = job.scoreResult || {};
  const minScore = config.thresholds.minScore;
  const breakdown = score.breakdown || {};
  const keywordScore = safeNumber(breakdown.keywords) || 0;

  const nearMiss =
    disposition === "below_threshold" &&
    typeof score.score === "number" &&
    score.score >= minScore - config.logging.nearMissWindow &&
    keywordScore > 0;

  const desc = job.description || "";
  const snippetLen = config.logging.descriptionSnippetLength;

  return {
    ts: new Date().toISOString(),
    disposition,
    link: job.link || null,
    title: job.title || null,

    // Why it was rejected (hard filter) — null for sent / below_threshold.
    rejectCategory: disposition === "hard_rejected" ? filter.category : null,
    matchedTerm: filter.matchedTerm || null,
    reason: (filter.reasons && filter.reasons[0]) || null,

    // Scoring picture.
    score: safeNumber(score.score),
    minScore,
    scorePassed: !!score.passed,
    nearMiss,
    scoreBreakdown: Object.keys(breakdown).length ? breakdown : null,
    topScoreReasons: Array.isArray(score.reasons)
      ? score.reasons.slice(0, 8)
      : [],

    // Job economics & client.
    proposalTier: filter.proposalTier || null,
    proposals: job.proposals || null,
    budget: safeNumber(job.budget),
    budgetType: job.budgetType || null,
    hourlyRange: job.hourlyRange || null,
    clientLocation: job.clientLocation || job.country || null,
    clientRating: safeNumber(job.clientRating),
    clientTotalSpent: safeNumber(job.clientTotalSpent),
    isContractToHire: !!job.isContractToHire,
    locationRestrictions: job.locationRestrictions || null,

    // Content.
    skills: Array.isArray(job.skills) ? job.skills : [],
    pubDate: job.pubDate
      ? new Date(job.pubDate).toISOString()
      : null,
    ageMinutes: ageMinutes(job),
    descriptionLength: desc.length,
    description:
      desc.length > snippetLen ? desc.slice(0, snippetLen) + "…" : desc,
  };
}

function appendRecord(record) {
  fs.appendFileSync(logFilePath(), JSON.stringify(record) + "\n");
}

/**
 * Log one scan's worth of outcomes. Pass the buckets straight from runScan.
 * Each job is logged at most once per dedup window, unless its disposition
 * improves (e.g. below_threshold -> sent), in which case the change is logged.
 */
function logScan({ sent = [], belowThreshold = [], hardRejected = [] } = {}) {
  if (!config.logging.enabled) return { logged: 0, skipped: 0 };

  ensureDirs();
  const seen = loadSeen();
  pruneSeen(seen);

  let logged = 0;
  let skipped = 0;

  // Order matters: process best outcome last so a "sent" transition wins.
  const buckets = [
    ["hard_rejected", hardRejected],
    ["below_threshold", belowThreshold],
    ["sent", sent],
  ];

  for (const [disposition, jobs] of buckets) {
    for (const job of jobs) {
      if (!job || !job.link) continue;
      const prev = seen[job.link];

      // Skip if we've already logged this link at an equal-or-better outcome.
      if (prev && DISPOSITION_RANK[disposition] <= DISPOSITION_RANK[prev.disposition]) {
        skipped++;
        continue;
      }

      try {
        appendRecord(buildRecord(job, disposition));
        seen[job.link] = { disposition, loggedAt: new Date().toISOString() };
        logged++;
      } catch (err) {
        console.error("lead-logger: append failed:", err.message);
      }
    }
  }

  saveSeen(seen);
  pruneOldFiles();
  return { logged, skipped };
}

/** Delete JSONL log + markdown report files older than retentionDays. */
function pruneOldFiles() {
  const cutoff =
    Date.now() - config.logging.retentionDays * 24 * 60 * 60 * 1000;
  const targets = [
    { dir: config.paths.logsDir, re: /^jobs-\d{4}-\d{2}-\d{2}\.jsonl$/ },
    { dir: config.paths.reportsDir, re: /^report-\d{4}-\d{2}-\d{2}\.md$/ },
  ];
  for (const { dir, re } of targets) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!re.test(f)) continue;
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

/**
 * Read all log records whose ts falls within the last `hours` hours.
 * Reads only the day-files that could contain the window. Returns an array.
 */
function readRecordsSince(hours) {
  if (!fs.existsSync(config.paths.logsDir)) return [];
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const records = [];

  // Figure out which day-files overlap the window (today + each prior day).
  const days = Math.ceil(hours / 24) + 1;
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const fp = logFilePath(d);
    if (!fs.existsSync(fp)) continue;
    const lines = fs.readFileSync(fp, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (new Date(rec.ts).getTime() >= cutoff) records.push(rec);
      } catch (_) {
        /* skip malformed line */
      }
    }
  }
  return records;
}

module.exports = {
  logScan,
  readRecordsSince,
  pruneOldFiles,
  logFilePath,
  dateStr,
  // exported for tests/report
  buildRecord,
  DISPOSITION_RANK,
};
