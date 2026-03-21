const config = require("../config");
const { sendSlack } = require("./slack");
const { sendEmail } = require("./email");
const { writeReport, writeLatestReport } = require("./file-output");

async function notify(jobs, scanInfo, stats) {
  if (jobs.length === 0) {
    console.log("No jobs to notify about.");
    return { sent: false, reason: "no_jobs" };
  }

  // Dev mode: write to file
  if (config.isDev) {
    console.log("DEV mode: Writing to file instead of sending notifications");
    const reportPath = writeReport(jobs, scanInfo, stats);
    writeLatestReport(jobs, scanInfo, stats);
    return { sent: true, method: "file", path: reportPath };
  }

  // Production: try Slack first, then email as fallback
  const results = [];

  // Slack
  if (config.slack.webhookUrl) {
    const slackSent = await sendSlack(jobs, scanInfo);
    if (slackSent) {
      results.push("slack");
      console.log("Slack notification sent");
    } else {
      console.log("Slack notification failed");
    }
  }

  // Email
  if (config.email.user && config.email.pass && config.email.to) {
    const emailSent = await sendEmail(jobs, scanInfo);
    if (emailSent) {
      results.push("email");
      console.log("Email notification sent");
    } else {
      console.log("Email notification failed");
    }
  }

  if (results.length > 0) {
    return { sent: true, method: results.join("+") };
  }

  // Fallback: write to file if all notifications failed
  console.log("All notifications failed, falling back to file output");
  const reportPath = writeReport(jobs, scanInfo, stats);
  return { sent: true, method: "file", path: reportPath };
}

module.exports = { notify };
