const express = require("express");
const cron = require("node-cron");
const config = require("./config");
const { fetchJobs } = require("./job_sources/upwork-feed");
const { filterJobs } = require("./filters/hard-reject");
const { scoreJobs } = require("./scoring/scorer");
const { notify } = require("./notifier");
const tracker = require("./data/tracker");

const app = express();

async function runScan() {
  // Runs 24/7 — no operating-hours restriction.
  console.log("\n========================================");
  console.log(`SCAN STARTED: ${new Date().toLocaleString()}`);
  console.log("========================================\n");

  const sentToday = tracker.getTodaySentCount();
  console.log(`Sent today so far: ${sentToday}`);

  const scanWindow = tracker.calculateScanWindow();
  console.log(`Scanning jobs from last ${scanWindow.maxAgeMinutes} minutes`);

  const stats = {
    fetched: 0,
    afterFilter: 0,
    afterScoring: 0,
    alreadySent: 0,
    newMatches: 0,
  };

  const allJobs = await fetchJobs(scanWindow);
  stats.fetched = allJobs.length;

  if (allJobs.length === 0) {
    console.log("No jobs found in scan window");
    tracker.recordRun(scanWindow.from, scanWindow.to, 0, 0);
    return;
  }

  const { passed: filteredJobs } = filterJobs(allJobs);
  stats.afterFilter = filteredJobs.length;

  if (filteredJobs.length === 0) {
    console.log("All jobs rejected by hard filters");
    tracker.recordRun(scanWindow.from, scanWindow.to, stats.fetched, 0);
    return;
  }

  const { scored: scoredJobs } = scoreJobs(filteredJobs);
  stats.afterScoring = scoredJobs.length;

  if (scoredJobs.length === 0) {
    console.log("No jobs passed scoring threshold");
    tracker.recordRun(scanWindow.from, scanWindow.to, stats.fetched, 0);
    return;
  }

  // Filter out already-sent jobs
  const newJobs = scoredJobs.filter((job) => !tracker.isLinkSent(job.link));
  stats.alreadySent = scoredJobs.length - newJobs.length;
  stats.newMatches = newJobs.length;

  console.log(
    `New jobs to send: ${newJobs.length} (${stats.alreadySent} already sent before)`
  );

  if (newJobs.length === 0) {
    console.log("No new jobs to notify about");
    tracker.recordRun(scanWindow.from, scanWindow.to, stats.fetched, 0);
    return;
  }

  const result = await notify(newJobs, scanWindow, stats);

  if (result.sent) {
    tracker.markMultipleLinksAsSent(newJobs);
    console.log(`Notification sent via ${result.method}`);
  }

  tracker.recordRun(
    scanWindow.from,
    scanWindow.to,
    stats.fetched,
    newJobs.length
  );

  console.log("\n========================================");
  console.log("SCAN COMPLETE");
  console.log(`  Fetched: ${stats.fetched}`);
  console.log(`  After filter: ${stats.afterFilter}`);
  console.log(`  After scoring: ${stats.afterScoring}`);
  console.log(`  New matches sent: ${stats.newMatches}`);
  console.log(`  Daily total: ${sentToday + stats.newMatches}`);
  console.log("========================================\n");
}

// Health / status endpoints
app.get("/", (req, res) => {
  const sentToday = tracker.getTodaySentCount();
  const utcHour = new Date().getUTCHours();
  res.json({
    status: "running",
    mode: config.isDev ? "development" : "production",
    operatingHours: "24/7",
    currentUtcHour: utcHour,
    isActive: true,
    scanInterval: `${config.rss.scanIntervalMinutes} minutes`,
    maxJobAge: `${config.thresholds.maxJobAgeMinutes} minutes`,
    minScore: config.thresholds.minScore,
    sentToday,
    lastRun: tracker.getLastRun(),
    notifications: {
      slack: !!config.slack.webhookUrl,
      email: !!(config.email.user && config.email.to),
    },
  });
});

app.get("/scan", async (req, res) => {
  try {
    await runScan();
    res.json({ success: true, message: "Scan completed" });
  } catch (err) {
    console.error("Scan error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/history", (req, res) => {
  const lastRun = tracker.getLastRun();
  const sentLinks = tracker.loadSentLinks();
  res.json({
    lastRun,
    sentLinksCount: sentLinks.links.length,
    todaySent: tracker.getTodaySentCount(),
    recentLinks: sentLinks.links.slice(-10),
  });
});

// Only start cron + server when run directly (not imported by manual-scan)
if (require.main === module) {
  cron.schedule(config.rss.cronSchedule, () => {
    console.log("Cron triggered scan");
    runScan().catch((err) => console.error("Scheduled scan error:", err));
  });
  console.log(`Cron scheduled: ${config.rss.cronSchedule}`);

  app.listen(config.port, () => {
    console.log(`\nUpwork Job Scanner running on port ${config.port}`);
    console.log(`Mode: ${config.isDev ? "DEVELOPMENT" : "PRODUCTION"}`);
    console.log(`Operating hours: 24/7`);
    console.log(`Scan every: ${config.rss.cronSchedule}`);
    console.log(`Max job age: ${config.thresholds.maxJobAgeMinutes} minutes`);
    console.log(`Min score: ${config.thresholds.minScore}`);
    console.log(`Fetch method: ${config.fetchMethod}`);
    console.log(
      `Slack: ${config.slack.webhookUrl ? "configured" : "NOT configured"}`
    );
    console.log(
      `Email: ${
        config.email.user && config.email.to ? "configured" : "NOT configured"
      }`
    );

    if (config.isDev) {
      console.log("\nDEV mode: Running initial scan...");
      runScan().catch((err) => console.error("Initial scan error:", err));
    }
  });
}

module.exports = { runScan, app };
