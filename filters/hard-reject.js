const config = require("../config");
const keywords = require("../config/keywords");
const locations = require("../config/locations");

function checkHires(job) {
  if (job.hires === undefined || job.hires === null) {
    return { passed: true, reason: "Hires count not available" };
  }
  if (job.hires >= 1) {
    return { passed: false, reason: `Job already has ${job.hires} hire(s)` };
  }
  return { passed: true, reason: "No hires yet" };
}

function checkLocation(job) {
  if (!job.clientLocation) {
    return { passed: true, reason: "Location not available", isRedFlag: false };
  }

  if (locations.isPreferred(job.clientLocation)) {
    return {
      passed: true,
      reason: `Preferred location: ${job.clientLocation}`,
      isRedFlag: false,
    };
  }

  if (locations.isRedFlag(job.clientLocation)) {
    return {
      passed: false,
      reason: `Client location not preferred: ${job.clientLocation}`,
      isRedFlag: true,
    };
  }

  return {
    passed: true,
    reason: `Location: ${job.clientLocation}`,
    isRedFlag: false,
  };
}

function containsRedFlagPhrase(text) {
  if (!keywords.redFlagPhrases) return null;
  const lowerText = text.toLowerCase();
  for (const phrase of keywords.redFlagPhrases) {
    if (lowerText.includes(phrase.toLowerCase())) {
      return phrase;
    }
  }
  return null;
}

function checkJobTitle(job) {
  const titleLower = job.title.toLowerCase();

  if (keywords.rejectTitles) {
    for (const rejectTitle of keywords.rejectTitles) {
      if (titleLower.includes(rejectTitle.toLowerCase())) {
        return {
          passed: false,
          reason: `Job title not relevant: "${job.title}"`,
        };
      }
    }
  }

  if (keywords.rejectTitlesUnlessDev) {
    for (const designTitle of keywords.rejectTitlesUnlessDev) {
      if (titleLower.includes(designTitle.toLowerCase())) {
        // Only check the title itself — description mentioning React/Tailwind
        // doesn't make a designer job a dev job
        const hasDevInTitle = [
          "developer",
          "engineer",
          "frontend",
          "backend",
          "full stack",
          "fullstack",
          "programmer",
        ].some((kw) => titleLower.includes(kw));

        if (!hasDevInTitle) {
          return {
            passed: false,
            reason: `Design-only job title: "${job.title}"`,
          };
        }
      }
    }
  }

  return { passed: true, reason: "Job title acceptable" };
}

function checkLocationRestrictions(job) {
  if (!job.locationRestrictions || job.locationRestrictions.length === 0) {
    return { passed: true, reason: "No location restrictions" };
  }

  const restrictions = job.locationRestrictions.join(" ").toLowerCase();
  const allowedForMe = [
    "egypt",
    "africa",
    "middle east",
    "worldwide",
    "anywhere",
  ];

  const hasMyLocation = allowedForMe.some((loc) => restrictions.includes(loc));

  if (!hasMyLocation) {
    return {
      passed: false,
      reason: `Location restricted to: ${job.locationRestrictions.join(
        ", "
      )} (Egypt/Africa/Middle East not included)`,
    };
  }

  return { passed: true, reason: "Location restrictions include my region" };
}

function checkMandatorySkills(job) {
  if (!job.skills || job.skills.length === 0) {
    return { passed: true, reason: "No skills to check" };
  }

  const skillsLower = job.skills.map((s) => s.toLowerCase());

  if (keywords.rejectSkillsStrict) {
    for (const rejectSkill of keywords.rejectSkillsStrict) {
      if (skillsLower.some((s) => s.includes(rejectSkill.toLowerCase()))) {
        return {
          passed: false,
          reason: `Contains reject skill: "${rejectSkill}"`,
        };
      }
    }
  }

  return { passed: true, reason: "Skills acceptable" };
}

function checkProposalCount(job) {
  if (!job.proposals) {
    return {
      passed: true,
      tier: "unknown",
      reason: "Proposal count not available",
    };
  }

  const count = job.proposals.max || job.proposals.min || 0;
  const limits = config.proposalLimits;

  if (count >= limits.reject) {
    return {
      passed: false,
      tier: "reject",
      reason: `Too many proposals: ${count}+ (limit: <${limits.reject})`,
    };
  }

  if (count <= limits.preferred[1]) {
    return {
      passed: true,
      tier: "preferred",
      reason: `Excellent: ${count} proposals`,
    };
  }
  if (count <= limits.good[1]) {
    return { passed: true, tier: "good", reason: `Good: ${count} proposals` };
  }
  if (count <= limits.acceptable[1]) {
    return {
      passed: true,
      tier: "acceptable",
      reason: `Acceptable: ${count} proposals`,
    };
  }
  if (count < limits.reject) {
    return {
      passed: true,
      tier: "marginal",
      reason: `Marginal: ${count} proposals`,
    };
  }

  return {
    passed: false,
    tier: "reject",
    reason: `Too many proposals: ${count}`,
  };
}

function containsRejectKeyword(text) {
  const lowerText = text.toLowerCase();
  for (const keyword of keywords.reject) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return keyword;
    }
  }
  return null;
}

function checkConditionalRejectKeywords(job) {
  if (!keywords.rejectUnlessWebDev)
    return { passed: true, reason: "No conditional keywords" };

  const textToCheck = `${job.title} ${job.description} ${job.skills.join(
    " "
  )}`.toLowerCase();

  const webDevKeywords = [
    "react",
    "node.js",
    "nodejs",
    "javascript",
    "typescript",
    "next.js",
    "nextjs",
    "frontend",
    "front-end",
    "backend",
    "back-end",
    "full stack",
    "fullstack",
    "web development",
    "web developer",
    "express",
    "api",
    "html",
    "css",
    "tailwind",
  ];

  const hasWebDevContext = webDevKeywords.some((kw) =>
    textToCheck.includes(kw)
  );

  if (hasWebDevContext) {
    return {
      passed: true,
      reason: "Has web dev context, allowing AI/Python keywords",
    };
  }

  for (const keyword of keywords.rejectUnlessWebDev) {
    if (textToCheck.includes(keyword.toLowerCase())) {
      return {
        passed: false,
        reason: `Contains "${keyword}" without web dev context`,
      };
    }
  }

  return { passed: true, reason: "No conditional reject keywords found" };
}

function checkBudget(job) {
  if (job.budgetType === "hourly") {
    if (job.hourlyRange && job.hourlyRange.max >= 25) {
      return { passed: true, reason: "Hourly rate acceptable" };
    }
    return { passed: true, reason: "Hourly job - no fixed budget to check" };
  }

  if (job.budget === null) {
    return { passed: true, reason: "Budget not specified" };
  }

  if (job.budget < config.thresholds.minBudget) {
    return {
      passed: false,
      reason: `Budget too low: $${job.budget} (min: $${config.thresholds.minBudget})`,
    };
  }

  return { passed: true, reason: `Budget acceptable: $${job.budget}` };
}

function checkJobAge(job) {
  const now = new Date();
  const ageMs = now.getTime() - job.pubDate.getTime();
  const ageMinutes = ageMs / (1000 * 60);

  if (ageMinutes > config.thresholds.maxJobAgeMinutes) {
    return {
      passed: false,
      reason: `Job too old: ${ageMinutes.toFixed(0)}min (max: ${config.thresholds.maxJobAgeMinutes}min)`,
    };
  }

  return {
    passed: true,
    reason: `Job age OK: ${ageMinutes.toFixed(0)}min`,
  };
}

function applyHardFilters(job) {
  const results = {
    passed: true,
    reasons: [],
    proposalTier: "unknown",
  };

  const titleCheck = checkJobTitle(job);
  if (!titleCheck.passed) {
    results.passed = false;
    results.reasons.push(titleCheck.reason);
    return results;
  }

  const skillsCheck = checkMandatorySkills(job);
  if (!skillsCheck.passed) {
    results.passed = false;
    results.reasons.push(skillsCheck.reason);
    return results;
  }

  const locationRestrictionsCheck = checkLocationRestrictions(job);
  if (!locationRestrictionsCheck.passed) {
    results.passed = false;
    results.reasons.push(locationRestrictionsCheck.reason);
    return results;
  }

  const hiresCheck = checkHires(job);
  if (!hiresCheck.passed) {
    results.passed = false;
    results.reasons.push(hiresCheck.reason);
    return results;
  }

  const proposalCheck = checkProposalCount(job);
  results.proposalTier = proposalCheck.tier;
  if (!proposalCheck.passed) {
    results.passed = false;
    results.reasons.push(proposalCheck.reason);
    return results;
  }
  results.reasons.push(proposalCheck.reason);

  const textToCheck = `${job.title} ${job.description} ${job.skills.join(" ")}`;

  const rejectKeyword = containsRejectKeyword(textToCheck);
  if (rejectKeyword) {
    results.passed = false;
    results.reasons.push(`Contains reject keyword: "${rejectKeyword}"`);
    return results;
  }

  const conditionalCheck = checkConditionalRejectKeywords(job);
  if (!conditionalCheck.passed) {
    results.passed = false;
    results.reasons.push(conditionalCheck.reason);
    return results;
  }

  const redFlagPhrase = containsRedFlagPhrase(textToCheck);
  if (redFlagPhrase) {
    results.passed = false;
    results.reasons.push(`Contains red flag phrase: "${redFlagPhrase}"`);
    return results;
  }

  const locationCheck = checkLocation(job);
  if (!locationCheck.passed) {
    results.passed = false;
    results.reasons.push(locationCheck.reason);
    return results;
  }
  results.reasons.push(locationCheck.reason);

  const budgetCheck = checkBudget(job);
  if (!budgetCheck.passed) {
    results.passed = false;
    results.reasons.push(budgetCheck.reason);
    return results;
  }
  results.reasons.push(budgetCheck.reason);

  const ageCheck = checkJobAge(job);
  if (!ageCheck.passed) {
    results.passed = false;
    results.reasons.push(ageCheck.reason);
    return results;
  }
  results.reasons.push(ageCheck.reason);

  return results;
}

function filterJobs(jobs) {
  const passed = [];
  const rejected = [];

  for (const job of jobs) {
    const result = applyHardFilters(job);
    if (result.passed) {
      job.filterResult = result;
      passed.push(job);
    } else {
      job.filterResult = result;
      rejected.push(job);
    }
  }

  console.log(
    `Hard filter: ${passed.length} passed, ${rejected.length} rejected`
  );
  return { passed, rejected };
}

module.exports = {
  filterJobs,
  applyHardFilters,
  checkProposalCount,
};
