/**
 * Generate the daily lead-quality report on demand.
 *
 * Usage:
 *   node scripts/generate-report.js            # last 24h, posts to Slack per config
 *   node scripts/generate-report.js 168        # last 7 days
 *   node scripts/generate-report.js 24 nopost  # don't post to Slack
 */

const { generateAndDeliverReport } = require("../reports/daily-report");

const hours = parseInt(process.argv[2], 10) || 24;
const post = process.argv[3] === "nopost" ? false : undefined;

console.log(`Generating lead-quality report (last ${hours}h)...`);
generateAndDeliverReport({ hours, post })
  .then((res) => {
    console.log("Report ready:", res.reportPath);
    console.log("Counts:", JSON.stringify(res.counts));
    console.log("Slack posted:", res.slackPosted);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Report failed:", err);
    process.exit(1);
  });
