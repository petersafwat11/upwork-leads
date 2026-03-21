const config = require("../config");
const keywords = require("../config/keywords");

function calculateKeywordScore(job) {
  const textToCheck = `${job.title} ${job.description} ${job.skills.join(
    " "
  )}`.toLowerCase();
  let score = 0;
  const matchedKeywords = [];

  for (const [category, data] of Object.entries(keywords.highPriority)) {
    for (const keyword of data.keywords) {
      if (textToCheck.includes(keyword.toLowerCase())) {
        score += data.points;
        matchedKeywords.push({
          keyword,
          points: data.points,
          category: "high",
        });
        break;
      }
    }
  }

  for (const [category, data] of Object.entries(keywords.mediumPriority)) {
    for (const keyword of data.keywords) {
      if (textToCheck.includes(keyword.toLowerCase())) {
        score += data.points;
        matchedKeywords.push({
          keyword,
          points: data.points,
          category: "medium",
        });
        break;
      }
    }
  }

  for (const [category, data] of Object.entries(keywords.lowPriority)) {
    for (const keyword of data.keywords) {
      if (textToCheck.includes(keyword.toLowerCase())) {
        score += data.points;
        matchedKeywords.push({ keyword, points: data.points, category: "low" });
        break;
      }
    }
  }

  return { score, matchedKeywords };
}

/**
 * Bonus when 2+ high-priority keywords match.
 * Job needs React+Node or Next.js+Express = perfect fit for your stack.
 */
function calculateStackDepthBonus(keywordResult) {
  const highMatches = keywordResult.matchedKeywords.filter(
    (m) => m.category === "high"
  ).length;

  if (highMatches >= 3) {
    return { score: 4, reason: `Deep stack match: ${highMatches} core skills (+4)` };
  }
  if (highMatches >= 2) {
    return { score: 2, reason: `Good stack match: ${highMatches} core skills (+2)` };
  }
  return { score: 0, reason: null };
}

function calculateBudgetScore(job) {
  let score = 0;
  const reasons = [];

  if (job.budgetType === "fixed" && job.budget) {
    // Sweet spot: $1000-5000 (not too small, not enterprise)
    if (job.budget >= 1000 && job.budget <= 5000) {
      score += 3;
      reasons.push(`Sweet spot budget: $${job.budget} (+3)`);
    } else if (job.budget >= config.thresholds.highBudgetThreshold) {
      score += 2;
      reasons.push(`High budget: $${job.budget} (+2)`);
    }
  }

  if (job.budgetType === "hourly" && job.hourlyRange) {
    // Sweet spot: $30-80/hr
    if (job.hourlyRange.min >= 30 && job.hourlyRange.max <= 100) {
      score += 3;
      reasons.push(
        `Good hourly range: $${job.hourlyRange.min}-$${job.hourlyRange.max}/hr (+3)`
      );
    } else if (job.hourlyRange.max >= 25) {
      score += 1;
      reasons.push(
        `Acceptable hourly: $${job.hourlyRange.min}-$${job.hourlyRange.max}/hr (+1)`
      );
    }
  }

  return { score, reasons };
}

function calculateRecencyScore(job) {
  const now = new Date();
  const ageMs = now.getTime() - job.pubDate.getTime();
  const ageMinutes = ageMs / (1000 * 60);

  // With 10min scans, very fresh jobs are gold
  if (ageMinutes < 5) {
    return { score: 3, reason: "Just posted (<5 min ago) (+3)" };
  }
  if (ageMinutes < 10) {
    return { score: 2, reason: "Very fresh (<10 min ago) (+2)" };
  }
  if (ageMinutes < 30) {
    return { score: 1, reason: "Fresh (<30 min ago) (+1)" };
  }

  return { score: 0, reason: null };
}

function calculateProposalBonus(job) {
  if (!job.filterResult || !job.filterResult.proposalTier) {
    return { score: 0, reason: null };
  }

  const tier = job.filterResult.proposalTier;
  switch (tier) {
    case "preferred":
      return { score: 3, reason: "Very few proposals: easy to stand out (+3)" };
    case "good":
      return { score: 2, reason: "Low proposals: good odds (+2)" };
    case "acceptable":
      return { score: 1, reason: "Moderate proposals (+1)" };
    default:
      return { score: 0, reason: null };
  }
}

function calculateClientBonus(job) {
  let score = 0;
  const reasons = [];

  if (job.isContractToHire) {
    score += 3;
    reasons.push("Contract-to-hire: long-term potential (+3)");
  }

  if (job.clientRating && job.clientRating >= 4.5) {
    score += 1;
    reasons.push(`High client rating: ${job.clientRating}/5 (+1)`);
  }

  if (job.clientTotalSpent && job.clientTotalSpent >= 10000) {
    score += 2;
    reasons.push(`Big spender client: $${job.clientTotalSpent} (+2)`);
  }

  if (job.clientAvgHourlyRate && job.clientAvgHourlyRate >= 25) {
    score += 1;
    reasons.push(
      `Good client hourly rate: $${job.clientAvgHourlyRate}/hr (+1)`
    );
  }

  return { score, reasons };
}

/**
 * Bonus for detailed descriptions.
 * Clients who write detailed requirements are serious and closeable.
 */
function calculateDescriptionQuality(job) {
  if (!job.description) return { score: 0, reason: null };

  const len = job.description.length;

  if (len >= 500) {
    return { score: 2, reason: "Detailed description: serious client (+2)" };
  }
  if (len >= 200) {
    return { score: 1, reason: "Good description length (+1)" };
  }

  return { score: 0, reason: null };
}

/**
 * Bonus for urgency signals.
 * Client needs someone NOW = faster hiring decision.
 */
function calculateUrgencyBonus(job) {
  if (!keywords.urgencyKeywords) return { score: 0, reason: null };

  const textToCheck = `${job.title} ${job.description}`.toLowerCase();

  for (const phrase of keywords.urgencyKeywords) {
    if (textToCheck.includes(phrase.toLowerCase())) {
      return { score: 2, reason: `Urgent: "${phrase}" (+2)` };
    }
  }

  return { score: 0, reason: null };
}

function scoreJob(job) {
  const keywordResult = calculateKeywordScore(job);
  const stackDepthResult = calculateStackDepthBonus(keywordResult);
  const budgetResult = calculateBudgetScore(job);
  const recencyResult = calculateRecencyScore(job);
  const proposalResult = calculateProposalBonus(job);
  const clientResult = calculateClientBonus(job);
  const descriptionResult = calculateDescriptionQuality(job);
  const urgencyResult = calculateUrgencyBonus(job);

  const totalScore =
    keywordResult.score +
    stackDepthResult.score +
    budgetResult.score +
    recencyResult.score +
    proposalResult.score +
    clientResult.score +
    descriptionResult.score +
    urgencyResult.score;

  const breakdown = {
    keywords: keywordResult.score,
    stackDepth: stackDepthResult.score,
    budget: budgetResult.score,
    recency: recencyResult.score,
    proposals: proposalResult.score,
    client: clientResult.score,
    description: descriptionResult.score,
    urgency: urgencyResult.score,
    total: totalScore,
  };

  const reasons = [];
  for (const match of keywordResult.matchedKeywords) {
    reasons.push(`Matched "${match.keyword}" (+${match.points})`);
  }
  if (stackDepthResult.reason) reasons.push(stackDepthResult.reason);
  reasons.push(...budgetResult.reasons);
  if (recencyResult.reason) reasons.push(recencyResult.reason);
  if (proposalResult.reason) reasons.push(proposalResult.reason);
  reasons.push(...clientResult.reasons);
  if (descriptionResult.reason) reasons.push(descriptionResult.reason);
  if (urgencyResult.reason) reasons.push(urgencyResult.reason);

  return {
    score: totalScore,
    breakdown,
    reasons,
    passed: totalScore >= config.thresholds.minScore,
  };
}

function scoreJobs(jobs) {
  const scored = [];
  const failed = [];

  for (const job of jobs) {
    const result = scoreJob(job);
    job.scoreResult = result;

    if (result.passed) {
      scored.push(job);
    } else {
      failed.push(job);
    }
  }

  // Sort by score descending, then by proposal tier (fewer = better)
  scored.sort((a, b) => {
    if (b.scoreResult.score !== a.scoreResult.score) {
      return b.scoreResult.score - a.scoreResult.score;
    }
    const tierOrder = {
      preferred: 0,
      good: 1,
      acceptable: 2,
      marginal: 3,
      unknown: 4,
    };
    const tierA = tierOrder[a.filterResult?.proposalTier] || 4;
    const tierB = tierOrder[b.filterResult?.proposalTier] || 4;
    return tierA - tierB;
  });

  console.log(
    `Scoring: ${scored.length} passed (score >= ${config.thresholds.minScore}), ${failed.length} failed`
  );
  return { scored, failed };
}

module.exports = {
  scoreJob,
  scoreJobs,
};
