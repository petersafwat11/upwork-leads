const config = require("../config");

function formatBudget(job) {
  if (job.budgetType === "hourly") {
    if (job.hourlyRange) {
      return `$${job.hourlyRange.min}-$${job.hourlyRange.max}/hr`;
    }
    return "Hourly";
  }
  if (job.budget) return `$${job.budget.toLocaleString()} fixed`;
  return "Not specified";
}

function formatProposals(job) {
  if (!job.proposals) return "N/A";
  if (job.proposals.min === job.proposals.max) return `${job.proposals.min}`;
  if (job.proposals.max === 999) return `${job.proposals.min}+`;
  return `${job.proposals.min}-${job.proposals.max}`;
}

function formatJobBlock(job, index) {
  const budget = formatBudget(job);
  const proposals = formatProposals(job);
  const score = job.scoreResult ? job.scoreResult.score : "?";
  const reasons = job.scoreResult
    ? job.scoreResult.reasons.slice(0, 3).join(" | ")
    : "";
  const desc = job.description
    ? job.description.substring(0, 200) + (job.description.length > 200 ? "..." : "")
    : "No description";
  const skills = job.skills && job.skills.length > 0
    ? job.skills.slice(0, 6).join(", ")
    : "None listed";
  const country = job.clientLocation || job.country || "Unknown";
  const ageMinutes = Math.round(
    (Date.now() - job.pubDate.getTime()) / 60000
  );
  const ageText =
    ageMinutes < 60
      ? `${ageMinutes}m ago`
      : `${Math.round(ageMinutes / 60)}h ago`;

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${index + 1}. <${job.link}|${job.title}>*`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Budget:* ${budget}` },
        { type: "mrkdwn", text: `*Proposals:* ${proposals}` },
        { type: "mrkdwn", text: `*Score:* ${score}` },
        { type: "mrkdwn", text: `*Posted:* ${ageText}` },
        { type: "mrkdwn", text: `*Location:* ${country}` },
        { type: "mrkdwn", text: `*Skills:* ${skills}` },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: desc,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_Why it passed:_ ${reasons}`,
        },
      ],
    },
    { type: "divider" },
  ];
}

async function sendSlack(jobs, scanInfo) {
  const webhookUrl = config.slack.webhookUrl;
  if (!webhookUrl) {
    console.error("SLACK_WEBHOOK_URL is not configured. Skipping Slack.");
    return false;
  }

  // Slack has a 50-block limit per message, so batch if needed
  // Each job uses ~5 blocks + 2 for header/footer = ~7 overhead
  const maxJobsPerMessage = 8;
  const batches = [];
  for (let i = 0; i < jobs.length; i += maxJobsPerMessage) {
    batches.push(jobs.slice(i, i + maxJobsPerMessage));
  }

  let allSent = true;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const isFirst = batchIndex === 0;
    const batchLabel =
      batches.length > 1
        ? ` (${batchIndex + 1}/${batches.length})`
        : "";

    const blocks = [];

    if (isFirst) {
      blocks.push({
        type: "header",
        text: {
          type: "plain_text",
          text: `${jobs.length} New Upwork Lead${jobs.length > 1 ? "s" : ""}${batchLabel}`,
          emoji: true,
        },
      });
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Last ${scanInfo.maxAgeMinutes || 15} min | ${new Date().toLocaleString()}`,
          },
        ],
      });
      blocks.push({ type: "divider" });
    } else {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `_Continued${batchLabel}_`,
          },
        ],
      });
      blocks.push({ type: "divider" });
    }

    const startIndex = batchIndex * maxJobsPerMessage;
    for (let i = 0; i < batch.length; i++) {
      blocks.push(...formatJobBlock(batch[i], startIndex + i));
    }

    const payload = { blocks };

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`Slack webhook error (${res.status}): ${body}`);
        allSent = false;
      }
    } catch (err) {
      console.error(`Slack send error: ${err.message}`);
      allSent = false;
    }

    // Rate limit: 1 message per second for webhooks
    if (batchIndex < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (allSent) {
    console.log(`Slack: sent ${jobs.length} jobs in ${batches.length} message(s)`);
  }
  return allSent;
}

module.exports = { sendSlack };
