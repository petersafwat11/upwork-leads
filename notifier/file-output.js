const fs = require("fs");
const path = require("path");
const config = require("../config");

function ensureOutputDir() {
  if (!fs.existsSync(config.paths.outputDir)) {
    fs.mkdirSync(config.paths.outputDir, { recursive: true });
  }
}

function formatJobForFile(job, index) {
  const proposalInfo = job.proposals
    ? `${job.proposals.min}-${job.proposals.max} proposals (${
        job.filterResult?.proposalTier || "unknown"
      })`
    : "Unknown proposals";

  const budgetInfo =
    job.budgetType === "hourly"
      ? job.hourlyRange
        ? `$${job.hourlyRange.min}-$${job.hourlyRange.max}/hr`
        : "Hourly"
      : job.budget
      ? `$${job.budget} fixed`
      : "Budget not specified";

  const scoreBreakdown = job.scoreResult.breakdown;
  const reasons = job.scoreResult.reasons.join("\n    - ");

  return `
================================================================================
JOB #${index + 1}: ${job.title}
================================================================================
Link: ${job.link}
Posted: ${job.pubDate.toLocaleString()}
Budget: ${budgetInfo}
Proposals: ${proposalInfo}

SCORE: ${job.scoreResult.score} / ${config.thresholds.minScore} minimum
  - Keywords: ${scoreBreakdown.keywords}
  - Budget: ${scoreBreakdown.budget}
  - Recency: ${scoreBreakdown.recency}
  - Proposals: ${scoreBreakdown.proposals}

WHY IT PASSED:
    - ${reasons}

DESCRIPTION:
${job.description.substring(0, 500)}${job.description.length > 500 ? "..." : ""}

SKILLS: ${job.skills.join(", ") || "None listed"}
`;
}

function generateReport(jobs, scanInfo, stats) {
  const header = `
################################################################################
                        UPWORK JOB SCAN REPORT
################################################################################

Scan Time: ${new Date().toLocaleString()}
Scan Window: ${scanInfo.from.toLocaleString()} - ${scanInfo.to.toLocaleString()}
${
  scanInfo.isFirstRun
    ? "(First run - full scan)"
    : `(Last run: ${scanInfo.lastRunAt?.toLocaleString() || "N/A"})`
}

SUMMARY:
  - Jobs fetched: ${stats.fetched}
  - After hard filter: ${stats.afterFilter}
  - After scoring: ${stats.afterScoring}
  - Already sent (skipped): ${stats.alreadySent}
  - New matches: ${stats.newMatches}

`;

  if (jobs.length === 0) {
    return header + "\nNo new matching jobs found.\n";
  }

  const jobsContent = jobs.map((job, i) => formatJobForFile(job, i)).join("\n");
  return header + jobsContent;
}

function writeReport(jobs, scanInfo, stats) {
  ensureOutputDir();

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .substring(0, 19);
  const filename = `scan-${timestamp}.txt`;
  const filepath = path.join(config.paths.outputDir, filename);

  const content = generateReport(jobs, scanInfo, stats);
  fs.writeFileSync(filepath, content);

  console.log(`Report written to: ${filepath}`);
  return filepath;
}

function writeLatestReport(jobs, scanInfo, stats) {
  ensureOutputDir();

  const filepath = path.join(config.paths.outputDir, "latest.txt");
  const content = generateReport(jobs, scanInfo, stats);
  fs.writeFileSync(filepath, content);

  console.log(`Latest report updated: ${filepath}`);
  return filepath;
}

module.exports = {
  writeReport,
  writeLatestReport,
  generateReport,
};
