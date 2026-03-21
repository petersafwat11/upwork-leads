require("dotenv").config();
const path = require("path");

const config = {
  env: process.env.NODE_ENV || "dev",
  isDev:
    process.env.NODE_ENV === "dev" || process.env.NODE_ENV === "development",

  port: parseInt(process.env.PORT, 10) || 3001,

  rss: {
    feedUrl: process.env.UPWORK_RSS_URL || "",
    scanIntervalMinutes: parseInt(process.env.MAX_JOB_AGE_MINUTES, 10) || 15,
    cronSchedule: process.env.CRON_SCHEDULE || "*/10 * * * *",
  },

  // How to fetch Upwork pages: "scraperapi", "flaresolverr", or "direct"
  fetchMethod: (process.env.FETCH_METHOD || "direct").toLowerCase(),
  scraperApiKey: process.env.SCRAPER_API_KEY || "",
  flareSolverrUrl: (process.env.FLARESOLVERR_URL || "").replace(/\/$/, ""),

  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || "",
  },

  email: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.EMAIL_FROM || "",
    to: process.env.EMAIL_TO || "",
  },

  thresholds: {
    minBudget: parseInt(process.env.MIN_BUDGET, 10) || 500,
    minHireRate: parseInt(process.env.MIN_HIRE_RATE, 10) || 50,
    minPastHires: parseInt(process.env.MIN_PAST_HIRES, 10) || 1,
    minScore: parseInt(process.env.MIN_SCORE, 10) || 8,
    maxJobAgeMinutes: parseInt(process.env.MAX_JOB_AGE_MINUTES, 10) || 15,
    highBudgetThreshold:
      parseInt(process.env.HIGH_BUDGET_THRESHOLD, 10) || 1000,
    highClientSpend: parseInt(process.env.HIGH_CLIENT_SPEND, 10) || 1500,
  },

  proposalLimits: {
    preferred: [0, 5],
    good: [5, 10],
    acceptable: [10, 15],
    marginal: [15, 20],
    reject: 20,
  },

  paths: {
    dataDir: path.join(__dirname, "..", "data"),
    sentLinksFile: path.join(__dirname, "..", "data", "sent-links.json"),
    runHistoryFile: path.join(__dirname, "..", "data", "run-history.json"),
    outputDir: path.join(__dirname, "..", "output"),
  },
};

module.exports = config;
