// Test the full pipeline with mock HTML data
const config = require("../config");
const { parseJobsFromHtml } = require("../job_sources/upwork-feed");
const { filterJobs } = require("../filters/hard-reject");
const { scoreJobs } = require("../scoring/scorer");
const tracker = require("../data/tracker");

console.log("All modules loaded successfully\n");
console.log("Config:", {
  env: config.env,
  fetchMethod: config.fetchMethod,
  scanInterval: `${config.rss.scanIntervalMinutes}min`,
  maxJobAge: `${config.thresholds.maxJobAgeMinutes}min`,
  minScore: config.thresholds.minScore,
  maxDailyLeads: config.thresholds.maxDailyLeads,
  proposalRejectAt: config.proposalLimits.reject,
  slackConfigured: !!config.slack.webhookUrl,
});

// Mock jobs that simulate real Upwork listings
const mockHtml = `<html><body>

<article data-test="JobTile">
<h2><a href="/jobs/~01abc">Senior React/Next.js Developer for SaaS Dashboard - ASAP</a></h2>
<p class="description">We need a senior full-stack developer to build an admin dashboard for our SaaS platform. Must know React, Next.js, Node.js, Express, and PostgreSQL. The project involves building a complete web application with authentication, data tables, and REST API. We're looking for someone who can start immediately. Budget is $2,500 for the full project. Looking for end-to-end ownership.</p>
<span class="skill-badge">React</span>
<span class="skill-badge">Next.js</span>
<span class="skill-badge">Node.js</span>
<span class="skill-badge">PostgreSQL</span>
<span class="skill-badge">Tailwind CSS</span>
<time>3 minutes ago</time>
<span>Less than 5 proposals</span>
</article>

<article data-test="JobTile">
<h2><a href="/jobs/~02def">WordPress Site Fix</a></h2>
<p class="description">Fix my WordPress site. Budget: $50.</p>
<span class="skill-badge">WordPress</span>
<time>5 minutes ago</time>
<span>15 to 20 proposals</span>
</article>

<article data-test="JobTile">
<h2><a href="/jobs/~03ghi">Node.js Express API Developer</a></h2>
<p class="description">Build REST API with Express and PostgreSQL. $30-$60/hr hourly. We need someone to build our backend API for a web application.</p>
<span class="skill-badge">Node.js</span>
<span class="skill-badge">Express</span>
<span class="skill-badge">REST API</span>
<time>8 minutes ago</time>
<span>5 to 10 proposals</span>
</article>

<article data-test="JobTile">
<h2><a href="/jobs/~04jkl">React Developer - Simple Landing Page</a></h2>
<p class="description">Need a simple landing page. $100 budget.</p>
<span class="skill-badge">React</span>
<time>12 minutes ago</time>
<span>10 to 15 proposals</span>
</article>

<article data-test="JobTile">
<h2><a href="/jobs/~05mno">Full Stack Developer for MVP - Internal Tool</a></h2>
<p class="description">We're building an MVP for an internal tool. Need a full-stack developer with React and Node.js experience. The project involves building a dashboard with data visualization, user management, and API integration. Looking for someone who can deliver a complete solution. Est. Budget: $3,000 fixed. Must be available to start this week.</p>
<span class="skill-badge">React</span>
<span class="skill-badge">Node.js</span>
<span class="skill-badge">TypeScript</span>
<span class="skill-badge">Dashboard</span>
<time>2 minutes ago</time>
<span>Less than 5 proposals</span>
</article>

<article data-test="JobTile">
<h2><a href="/jobs/~06pqr">Generic JavaScript Developer</a></h2>
<p class="description">Need JS help.</p>
<span class="skill-badge">JavaScript</span>
<time>14 minutes ago</time>
<span>20 to 50 proposals</span>
</article>

</body></html>`;

const jobs = parseJobsFromHtml(mockHtml);
console.log("\n--- PARSING ---");
console.log(`Parsed ${jobs.length} jobs from HTML\n`);

jobs.forEach((j, i) => {
  const proposals = j.proposals
    ? `${j.proposals.min}-${j.proposals.max}`
    : "N/A";
  const age = Math.round((Date.now() - j.pubDate.getTime()) / 60000);
  console.log(
    `  ${i + 1}. ${j.title}`
  );
  console.log(
    `     Budget: ${j.budget || "N/A"} ${j.budgetType} | Proposals: ${proposals} | Age: ${age}min | Desc: ${j.description.length} chars`
  );
});

console.log("\n--- FILTERING ---");
const { passed, rejected } = filterJobs(jobs);

if (rejected.length > 0) {
  console.log("\nRejected:");
  rejected.forEach((j) => {
    const reason = j.filterResult.reasons.find(
      (r) => !r.startsWith("Excellent") && !r.startsWith("Good") && !r.startsWith("Acceptable") && !r.startsWith("Marginal")
    ) || j.filterResult.reasons[j.filterResult.reasons.length - 1];
    console.log(`  X ${j.title} -> ${reason}`);
  });
}

console.log("\n--- SCORING ---");
if (passed.length > 0) {
  const { scored, failed } = scoreJobs(passed);

  if (scored.length > 0) {
    console.log("\nPASSED (would be sent to Slack):");
    scored.forEach((j, i) => {
      console.log(`\n  #${i + 1} ${j.title}`);
      console.log(`     Score: ${j.scoreResult.score} (min: ${config.thresholds.minScore})`);
      console.log(`     Breakdown: kw=${j.scoreResult.breakdown.keywords} stack=${j.scoreResult.breakdown.stackDepth} budget=${j.scoreResult.breakdown.budget} fresh=${j.scoreResult.breakdown.recency} proposals=${j.scoreResult.breakdown.proposals} desc=${j.scoreResult.breakdown.description} urgent=${j.scoreResult.breakdown.urgency}`);
      console.log(`     Reasons: ${j.scoreResult.reasons.join(", ")}`);
    });
  }

  if (failed.length > 0) {
    console.log("\nBelow threshold:");
    failed.forEach((j) => {
      console.log(`  - ${j.title}: score=${j.scoreResult.score}`);
    });
  }
}

console.log("\n--- DAILY CAP ---");
console.log(`Sent today: ${tracker.getTodaySentCount()}`);
console.log(`Remaining slots: ${tracker.getRemainingDailySlots()}`);

console.log("\nPipeline test complete!");
