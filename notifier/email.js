const nodemailer = require("nodemailer");
const config = require("../config");

function createTransporter() {
  return nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });
}

function formatJobForEmail(job) {
  const proposalInfo = job.proposals
    ? `${job.proposals.min}-${job.proposals.max} proposals`
    : "Unknown proposals";

  const budgetInfo =
    job.budgetType === "hourly"
      ? job.hourlyRange
        ? `$${job.hourlyRange.min}-$${job.hourlyRange.max}/hr`
        : "Hourly"
      : job.budget
      ? `$${job.budget} fixed`
      : "Budget not specified";

  const scoreReasons = job.scoreResult.reasons.slice(0, 3).join(", ");

  return `
<div style="border: 1px solid #ddd; padding: 15px; margin-bottom: 15px; border-radius: 5px;">
  <h3 style="margin: 0 0 10px 0;">
    <a href="${job.link}" style="color: #14a800; text-decoration: none;">${
    job.title
  }</a>
  </h3>
  <p style="margin: 5px 0; color: #666;">
    <strong>Budget:</strong> ${budgetInfo} | 
    <strong>Proposals:</strong> ${proposalInfo} |
    <strong>Score:</strong> ${job.scoreResult.score}
  </p>
  <p style="margin: 5px 0; color: #666;">
    <strong>Posted:</strong> ${job.pubDate.toLocaleString()}
  </p>
  <p style="margin: 10px 0;">${job.description.substring(0, 300)}${
    job.description.length > 300 ? "..." : ""
  }</p>
  <p style="margin: 5px 0; color: #14a800; font-size: 12px;">
    <strong>Why it passed:</strong> ${scoreReasons}
  </p>
  <p style="margin: 5px 0;">
    <a href="${
      job.link
    }" style="background: #14a800; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; display: inline-block;">View Job</a>
  </p>
</div>`;
}

function generateEmailHtml(jobs, scanInfo) {
  const jobsHtml = jobs.map(formatJobForEmail).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Upwork Job Matches</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #14a800;">Upwork Job Matches</h1>
  <p style="color: #666;">
    Scanned: ${scanInfo.from.toLocaleString()} - ${scanInfo.to.toLocaleString()}<br>
    Found: ${jobs.length} matching job(s)
  </p>
  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
  ${jobsHtml}
  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">
    This is an automated notification from Upwork Job Scanner.
  </p>
</body>
</html>`;
}

async function sendEmail(jobs, scanInfo) {
  if (!config.email.user || !config.email.pass) {
    console.error("Email credentials not configured. Skipping email.");
    return false;
  }

  if (!config.email.to) {
    console.error("Email recipient not configured. Skipping email.");
    return false;
  }

  const transporter = createTransporter();
  const html = generateEmailHtml(jobs, scanInfo);

  const mailOptions = {
    from: config.email.from || config.email.user,
    to: config.email.to,
    subject: `[Upwork] ${jobs.length} New Job Match${
      jobs.length > 1 ? "es" : ""
    } - ${new Date().toLocaleDateString()}`,
    html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error("Error sending email:", err.message);
    return false;
  }
}

module.exports = {
  sendEmail,
  generateEmailHtml,
};
