const fs = require("fs");
const path = require("path");
const config = require("../config");

function ensureDataDir() {
  if (!fs.existsSync(config.paths.dataDir)) {
    fs.mkdirSync(config.paths.dataDir, { recursive: true });
  }
}

function loadSentLinks() {
  ensureDataDir();
  if (!fs.existsSync(config.paths.sentLinksFile)) {
    return { links: [], lastCleanup: Date.now() };
  }
  try {
    const data = fs.readFileSync(config.paths.sentLinksFile, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading sent links:", err.message);
    return { links: [], lastCleanup: Date.now() };
  }
}

function saveSentLinks(data) {
  ensureDataDir();
  fs.writeFileSync(config.paths.sentLinksFile, JSON.stringify(data, null, 2));
}

function isLinkSent(link) {
  const data = loadSentLinks();
  return data.links.some((item) => item.url === link);
}

function markLinkAsSent(link, jobTitle) {
  const data = loadSentLinks();
  if (!data.links.some((item) => item.url === link)) {
    data.links.push({
      url: link,
      title: jobTitle,
      sentAt: new Date().toISOString(),
    });
    cleanupOldLinks(data);
    saveSentLinks(data);
  }
}

function markMultipleLinksAsSent(jobs) {
  const data = loadSentLinks();
  let added = 0;
  for (const job of jobs) {
    if (!data.links.some((item) => item.url === job.link)) {
      data.links.push({
        url: job.link,
        title: job.title,
        sentAt: new Date().toISOString(),
      });
      added++;
    }
  }
  if (added > 0) {
    cleanupOldLinks(data);
    saveSentLinks(data);
  }
  return added;
}

function cleanupOldLinks(data) {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (data.lastCleanup && data.lastCleanup > thirtyDaysAgo) {
    return;
  }
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  data.links = data.links.filter((item) => {
    const sentTime = new Date(item.sentAt).getTime();
    return sentTime > sevenDaysAgo;
  });
  data.lastCleanup = Date.now();
}

/**
 * Count how many leads were sent today (since midnight UTC).
 */
function getTodaySentCount() {
  const data = loadSentLinks();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  return data.links.filter((item) => {
    return new Date(item.sentAt).getTime() >= todayMs;
  }).length;
}

/**
 * How many more leads can be sent today before hitting the daily cap.
 */
function getRemainingDailySlots() {
  const sentToday = getTodaySentCount();
  const max = config.thresholds.maxDailyLeads;
  return Math.max(0, max - sentToday);
}

function loadRunHistory() {
  ensureDataDir();
  if (!fs.existsSync(config.paths.runHistoryFile)) {
    return { runs: [] };
  }
  try {
    const data = fs.readFileSync(config.paths.runHistoryFile, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading run history:", err.message);
    return { runs: [] };
  }
}

function saveRunHistory(data) {
  ensureDataDir();
  fs.writeFileSync(config.paths.runHistoryFile, JSON.stringify(data, null, 2));
}

function getLastRun() {
  const history = loadRunHistory();
  if (history.runs.length === 0) {
    return null;
  }
  return history.runs[history.runs.length - 1];
}

function recordRun(scannedFrom, scannedTo, jobsFound, jobsSent) {
  const history = loadRunHistory();
  history.runs.push({
    runAt: new Date().toISOString(),
    scannedFrom: scannedFrom.toISOString(),
    scannedTo: scannedTo.toISOString(),
    jobsFound,
    jobsSent,
  });
  // Keep last 1000 runs (~7 days at 10min intervals)
  if (history.runs.length > 1000) {
    history.runs = history.runs.slice(-1000);
  }
  saveRunHistory(history);
}

function calculateScanWindow() {
  const now = new Date();
  const maxLookbackMs = config.rss.scanIntervalMinutes * 60 * 1000;

  return {
    from: new Date(now.getTime() - maxLookbackMs),
    to: now,
    maxAgeMinutes: config.rss.scanIntervalMinutes,
  };
}

module.exports = {
  isLinkSent,
  markLinkAsSent,
  markMultipleLinksAsSent,
  loadSentLinks,
  getTodaySentCount,
  getRemainingDailySlots,
  getLastRun,
  recordRun,
  calculateScanWindow,
};
