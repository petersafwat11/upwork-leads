const Parser = require("rss-parser");
const config = require("../config");

const parser = new Parser({
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      ["description", "description"],
    ],
  },
  timeout: 30000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
});

/**
 * Convert an Upwork search page URL to an RSS feed URL.
 * Search: https://www.upwork.com/nx/search/jobs/?q=...
 * RSS:    https://www.upwork.com/ab/feed/jobs/rss?q=...
 */
function toRssUrl(url) {
  if (!url) return "";

  // Already an RSS/Atom feed URL
  if (url.includes("/ab/feed/jobs/")) return url;

  // Convert search page URL to RSS feed URL
  if (url.includes("/nx/search/jobs/") || url.includes("/search/jobs")) {
    try {
      const parsed = new URL(url);
      const params = parsed.searchParams;
      // Build RSS URL with same query params
      const rssUrl = new URL("https://www.upwork.com/ab/feed/jobs/rss");
      for (const [key, value] of params) {
        rssUrl.searchParams.set(key, value);
      }
      // Ensure sort by recency
      if (!rssUrl.searchParams.has("sort")) {
        rssUrl.searchParams.set("sort", "recency");
      }
      // Request more results
      if (!rssUrl.searchParams.has("paging")) {
        rssUrl.searchParams.set("paging", "0;50");
      }
      return rssUrl.toString();
    } catch (e) {
      console.error("Failed to parse search URL, using as-is:", e.message);
      return url;
    }
  }

  return url;
}

function parseJobDetails(item) {
  const content =
    item.contentEncoded || item.description || item.content || "";
  const job = {
    title: (item.title || "Untitled").trim(),
    link: item.link || "",
    pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
    description: "",
    budget: null,
    budgetType: null,
    hourlyRange: null,
    category: "",
    skills: [],
    country: "",
    proposals: null,
    // These fields won't be available from RSS (only from scraper)
    // Filters handle them gracefully when null/undefined
    hires: undefined,
    clientLocation: undefined,
    clientAvgHourlyRate: undefined,
    clientTotalSpent: undefined,
    clientHireRate: undefined,
    clientRating: undefined,
    isContractToHire: false,
    locationRestrictions: [],
  };

  job.description = extractDescription(content);
  job.budget = extractBudget(content);
  job.budgetType = extractBudgetType(content);
  job.hourlyRange = extractHourlyRange(content);
  job.category = extractField(content, "Category");
  job.skills = extractSkills(content);
  job.country = extractField(content, "Country");
  job.proposals = extractProposals(content);

  // Use country as clientLocation for location-based filtering
  if (job.country) {
    job.clientLocation = job.country;
  }

  return job;
}

function extractDescription(content) {
  let desc = content;
  // Get text before the first <br /> which typically separates description from metadata
  const brIndex = desc.indexOf("<br />");
  if (brIndex !== -1) {
    desc = desc.substring(0, brIndex);
  }
  // Strip HTML tags
  desc = desc.replace(/<[^>]*>/g, "");
  // Decode HTML entities
  desc = desc.replace(/&nbsp;/g, " ");
  desc = desc.replace(/&amp;/g, "&");
  desc = desc.replace(/&lt;/g, "<");
  desc = desc.replace(/&gt;/g, ">");
  desc = desc.replace(/&quot;/g, '"');
  desc = desc.replace(/&#39;/g, "'");
  desc = desc.replace(/\s+/g, " ");
  return desc.trim();
}

function extractBudget(content) {
  // Fixed budget: <b>Budget</b>: $1,500
  const fixedMatch = content.match(/Budget<\/b>:\s*\$?([\d,]+)/i);
  if (fixedMatch) {
    return parseInt(fixedMatch[1].replace(/,/g, ""), 10);
  }
  // Fallback: any dollar amount not in hourly context
  if (!/Hourly Range/i.test(content)) {
    const budgetMatch = content.match(
      /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/
    );
    if (budgetMatch) {
      return parseInt(budgetMatch[1].replace(/,/g, ""), 10);
    }
  }
  return null;
}

function extractBudgetType(content) {
  if (/Hourly Range/i.test(content)) return "hourly";
  if (/Budget<\/b>/i.test(content)) return "fixed";
  return "unknown";
}

function extractHourlyRange(content) {
  const match = content.match(
    /Hourly Range<\/b>:\s*\$?([\d.]+)\s*-\s*\$?([\d.]+)/i
  );
  if (match) {
    return { min: parseFloat(match[1]), max: parseFloat(match[2]) };
  }
  return null;
}

function extractField(content, fieldName) {
  const regex = new RegExp(`${fieldName}<\\/b>:\\s*([^<]+)`, "i");
  const match = content.match(regex);
  return match ? match[1].trim() : "";
}

function extractSkills(content) {
  const match = content.match(/Skills<\/b>:\s*([^<]+)/i);
  if (match) {
    return match[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s);
  }
  return [];
}

function extractProposals(content) {
  const patterns = [
    /(\d+)\s*to\s*(\d+)\s*proposals?/i,
    /Proposals<\/b>:\s*(\d+)\s*to\s*(\d+)/i,
    /(\d+)\s*-\s*(\d+)\s*proposals?/i,
    /Less than\s*(\d+)\s*proposals?/i,
    /(\d+)\+?\s*proposals?/i,
    /Proposals<\/b>:\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      if (match[2]) {
        return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
      }
      if (/less than/i.test(match[0])) {
        return { min: 0, max: parseInt(match[1], 10) };
      }
      if (/\+/.test(match[0])) {
        return { min: parseInt(match[1], 10), max: 999 };
      }
      const num = parseInt(match[1], 10);
      return { min: num, max: num };
    }
  }
  return null;
}

async function fetchJobs(scanWindow) {
  const rawUrl = config.rss.feedUrl;
  if (!rawUrl) {
    console.error("UPWORK_RSS_URL is not configured");
    return [];
  }

  const feedUrl = toRssUrl(rawUrl);
  console.log(`RSS feed URL: ${feedUrl.substring(0, 80)}...`);

  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `Fetching RSS feed (attempt ${attempt}/${maxRetries})...`
      );
      const feed = await parser.parseURL(feedUrl);
      console.log(`Found ${feed.items.length} items in feed`);

      const jobs = feed.items
        .map((item) => parseJobDetails(item))
        .filter((job) => {
          if (!scanWindow) return true;
          return job.pubDate >= scanWindow.from && job.pubDate <= scanWindow.to;
        });

      console.log(`${jobs.length} jobs within scan window`);
      return jobs;
    } catch (err) {
      lastError = err;
      console.error(
        `RSS fetch attempt ${attempt} failed: ${err.message}`
      );
      if (attempt < maxRetries) {
        const delay = attempt * 5000;
        console.log(`Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  console.error(`All ${maxRetries} RSS fetch attempts failed: ${lastError.message}`);
  return [];
}

module.exports = {
  fetchJobs,
  parseJobDetails,
  toRssUrl,
};
