const cheerio = require("cheerio");
const config = require("../config");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Fetch HTML from Upwork, handling Cloudflare via configured proxy method.
 *
 * Supported methods (set via FETCH_METHOD env var):
 *   - "browser"      : Puppeteer + stealth (custom, free, recommended for Railway)
 *   - "scraperapi"   : Uses ScraperAPI.com (needs SCRAPER_API_KEY)
 *   - "flaresolverr" : Uses self-hosted FlareSolverr (needs FLARESOLVERR_URL)
 *   - "direct"       : Direct HTTP fetch (may be blocked by Cloudflare)
 */
async function fetchHtml(url) {
  const method = config.fetchMethod;

  switch (method) {
    case "browser":
      return fetchViaBrowser(url);
    case "scraperapi":
      return fetchViaScraperApi(url);
    case "flaresolverr":
      return fetchViaFlareSolverr(url);
    case "direct":
      return fetchDirect(url);
    default:
      console.error(`Unknown FETCH_METHOD: ${method}, trying browser`);
      return fetchViaBrowser(url);
  }
}

async function fetchViaBrowser(url) {
  const { fetchHtml: browserFetch } = require("./browser-fetch");
  console.log("  Fetching via stealth browser...");
  return browserFetch(url);
}

async function fetchViaScraperApi(url) {
  const apiKey = config.scraperApiKey;
  if (!apiKey) {
    throw new Error("SCRAPER_API_KEY is required when FETCH_METHOD=scraperapi");
  }

  const proxyUrl = `http://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(url)}&render=true&country_code=us`;

  console.log("  Fetching via ScraperAPI...");
  const res = await fetch(proxyUrl, {
    headers: { Accept: "text/html" },
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    throw new Error(`ScraperAPI returned ${res.status}: ${res.statusText}`);
  }
  return res.text();
}

async function fetchViaFlareSolverr(url) {
  const solverrUrl = config.flareSolverrUrl;
  if (!solverrUrl) {
    throw new Error(
      "FLARESOLVERR_URL is required when FETCH_METHOD=flaresolverr"
    );
  }

  console.log("  Fetching via FlareSolverr...");
  const res = await fetch(`${solverrUrl}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cmd: "request.get",
      url: url,
      maxTimeout: 60000,
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    throw new Error(`FlareSolverr returned ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(`FlareSolverr error: ${data.message || "unknown"}`);
  }
  return data.solution.response;
}

async function fetchDirect(url) {
  console.log("  Fetching directly (may be blocked by Cloudflare)...");
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (res.status === 403) {
    throw new Error(
      "Cloudflare blocked the request (403). Use FETCH_METHOD=scraperapi or flaresolverr."
    );
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.text();
}

/**
 * Parse Upwork search results HTML into job objects.
 */
function parseJobsFromHtml(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  // Upwork uses various selectors for job tiles
  const jobSelectors = [
    'article[data-test="JobTile"]',
    'article[data-ev-label="search_results_impression"]',
    'section[data-test="job-tile-list"] > div',
    "article",
    '[class*="job-tile"]',
  ];

  let jobElements = $([]);
  for (const sel of jobSelectors) {
    jobElements = $(sel);
    if (jobElements.length > 0) {
      console.log(
        `  Found ${jobElements.length} jobs using selector: ${sel}`
      );
      break;
    }
  }

  if (jobElements.length === 0) {
    // Try to find jobs in embedded JSON (__NEXT_DATA__ or similar)
    const nextData = parseNextData($, html);
    if (nextData.length > 0) return nextData;

    console.log("  No job elements found in HTML");
    return [];
  }

  jobElements.each((i, el) => {
    try {
      const $el = $(el);
      const job = parseJobElement($, $el);
      if (job && job.title && job.link) {
        jobs.push(job);
      }
    } catch (e) {
      // Skip unparseable elements
    }
  });

  return jobs;
}

function parseJobElement($, $el) {
  // Title and link
  const titleEl = $el.find(
    'h2 a, h3 a, a[href*="/jobs/"], [data-test="job-tile-title-link"]'
  );
  const title = titleEl.text().trim();
  let link = titleEl.attr("href") || "";
  if (link && !link.startsWith("http")) {
    link = "https://www.upwork.com" + link;
  }

  if (!title || !link) return null;

  // Description
  const descEl = $el.find(
    '[data-test="job-description-text"], [class*="description"], p'
  );
  const description = descEl.first().text().trim();

  // All text for regex extraction
  const allText = $el.text();

  // Budget
  const budgetInfo = parseBudgetFromText(allText);

  // Posted time
  const postedText = extractPostedTime(allText);
  const pubDate = parseTimeAgo(postedText);

  // Proposals
  const proposals = extractProposals(allText);

  // Skills
  const skills = [];
  $el
    .find(
      '[class*="token"], [class*="skill"], [class*="badge"], [data-test="skill"]'
    )
    .each((i, skillEl) => {
      const text = $(skillEl).text().trim();
      if (text && text.length < 40) skills.push(text);
    });

  // Country (if available in tile)
  const country = extractCountry(allText);

  return {
    title,
    link,
    description,
    pubDate,
    budget: budgetInfo.budget,
    budgetType: budgetInfo.budgetType,
    hourlyRange: budgetInfo.hourlyRange,
    skills,
    country,
    clientLocation: country || undefined,
    proposals,
    hires: undefined,
    clientAvgHourlyRate: undefined,
    clientTotalSpent: undefined,
    clientHireRate: undefined,
    clientRating: undefined,
    isContractToHire: allText.toLowerCase().includes("contract-to-hire"),
    locationRestrictions: [],
  };
}

/**
 * Try to extract job data from __NEXT_DATA__ or inline JSON.
 */
function parseNextData($, html) {
  const jobs = [];

  // Try __NEXT_DATA__
  const scriptEl = $("#__NEXT_DATA__");
  if (scriptEl.length > 0) {
    try {
      const data = JSON.parse(scriptEl.html());
      const searchResults =
        data?.props?.pageProps?.searchResults?.jobs ||
        data?.props?.pageProps?.jobs ||
        [];

      for (const item of searchResults) {
        jobs.push({
          title: item.title || "",
          link: item.ciphertext
            ? `https://www.upwork.com/jobs/${item.ciphertext}`
            : item.link || "",
          description: item.description || item.snippet || "",
          pubDate: item.createdOn
            ? new Date(item.createdOn)
            : new Date(item.publishedOn || Date.now()),
          budget: item.amount?.amount
            ? parseFloat(item.amount.amount)
            : null,
          budgetType: item.type?.includes("hourly")
            ? "hourly"
            : item.amount
            ? "fixed"
            : "unknown",
          hourlyRange: item.hourlyBudget
            ? {
                min: parseFloat(item.hourlyBudget.min || 0),
                max: parseFloat(item.hourlyBudget.max || 0),
              }
            : null,
          skills: (item.skills || item.attrs?.skills || []).map(
            (s) => s.name || s.prettyName || s
          ),
          country: item.client?.location?.country || "",
          clientLocation: item.client?.location?.country || undefined,
          proposals:
            item.proposalsTier !== undefined
              ? parseProposalTier(item.proposalsTier)
              : item.totalApplicants
              ? { min: item.totalApplicants, max: item.totalApplicants }
              : null,
          hires: item.client?.totalHires || undefined,
          clientTotalSpent: item.client?.totalSpent?.amount
            ? parseFloat(item.client.totalSpent.amount)
            : undefined,
          clientHireRate: item.client?.totalHires
            ? undefined
            : undefined,
          clientRating: item.client?.totalFeedback || undefined,
          clientAvgHourlyRate: undefined,
          isContractToHire: item.contractToHire || false,
          locationRestrictions: [],
        });
      }

      if (jobs.length > 0) {
        console.log(
          `  Extracted ${jobs.length} jobs from __NEXT_DATA__ JSON`
        );
      }
    } catch (e) {
      console.log("  Failed to parse __NEXT_DATA__:", e.message);
    }
  }

  // Try inline script with search data
  if (jobs.length === 0) {
    const scriptTags = $("script")
      .map((i, el) => $(el).html())
      .get();

    for (const script of scriptTags) {
      if (
        script &&
        (script.includes("searchResults") || script.includes("jobPostings"))
      ) {
        try {
          const match = script.match(
            /(?:searchResults|jobPostings)\s*[:=]\s*(\[[\s\S]*?\])/
          );
          if (match) {
            const data = JSON.parse(match[1]);
            console.log(`  Found ${data.length} jobs in inline script`);
            // Parse similar to __NEXT_DATA__
          }
        } catch (e) {
          // Not parseable
        }
      }
    }
  }

  return jobs;
}

function parseProposalTier(tier) {
  // Upwork proposal tiers: 0 = 0-5, 1 = 5-10, 2 = 10-15, 3 = 15-20, 4 = 20-50, 5 = 50+
  const tiers = [
    { min: 0, max: 5 },
    { min: 5, max: 10 },
    { min: 10, max: 15 },
    { min: 15, max: 20 },
    { min: 20, max: 50 },
    { min: 50, max: 999 },
  ];
  return tiers[tier] || null;
}

function parseBudgetFromText(text) {
  if (!text) return { budget: null, budgetType: "unknown", hourlyRange: null };

  // Hourly range
  const hourlyMatch = text.match(
    /\$?([\d.]+)\s*-\s*\$?([\d.]+)\s*(?:\/hr|hourly|per hour)/i
  );
  if (hourlyMatch) {
    return {
      budget: null,
      budgetType: "hourly",
      hourlyRange: {
        min: parseFloat(hourlyMatch[1]),
        max: parseFloat(hourlyMatch[2]),
      },
    };
  }

  // "Hourly" mention without range
  if (/hourly/i.test(text) && !/fixed/i.test(text)) {
    const rangeMatch = text.match(/\$?([\d.]+)\s*-\s*\$?([\d.]+)/);
    if (rangeMatch) {
      return {
        budget: null,
        budgetType: "hourly",
        hourlyRange: {
          min: parseFloat(rangeMatch[1]),
          max: parseFloat(rangeMatch[2]),
        },
      };
    }
    return { budget: null, budgetType: "hourly", hourlyRange: null };
  }

  // Fixed budget
  const fixedMatch = text.match(
    /(?:Est\.\s*Budget|Budget|Fixed-price)[\s:]*\$?([\d,]+(?:\.\d{2})?)/i
  );
  if (fixedMatch) {
    return {
      budget: parseInt(fixedMatch[1].replace(/,/g, ""), 10),
      budgetType: "fixed",
      hourlyRange: null,
    };
  }

  // Any dollar amount
  const dollarMatch = text.match(/\$([\d,]+(?:\.\d{2})?)/);
  if (dollarMatch) {
    const amount = parseInt(dollarMatch[1].replace(/,/g, ""), 10);
    if (amount >= 50) {
      return { budget: amount, budgetType: "fixed", hourlyRange: null };
    }
  }

  return { budget: null, budgetType: "unknown", hourlyRange: null };
}

function extractPostedTime(text) {
  const match = text.match(
    /(\d+\s*(?:second|minute|hour|day|week|month)s?\s*ago|just now|yesterday|moments ago)/i
  );
  return match ? match[1] : "";
}

function parseTimeAgo(timeStr) {
  if (!timeStr) return new Date();
  const now = new Date();
  const lower = timeStr.toLowerCase();

  if (lower.includes("just now") || lower.includes("moments ago")) return now;

  const match = lower.match(/(\d+)\s*(second|minute|hour|day|week|month)/);
  if (!match) return now;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };

  return new Date(now.getTime() - value * multipliers[unit]);
}

function extractProposals(text) {
  const patterns = [
    /(\d+)\s*to\s*(\d+)\s*proposals?/i,
    /(\d+)\s*-\s*(\d+)\s*proposals?/i,
    /Less than\s*(\d+)\s*proposals?/i,
    /(\d+)\+\s*proposals?/i,
    /Proposals:\s*(\d+)\s*to\s*(\d+)/i,
    /Proposals:\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[2])
        return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
      if (/less than/i.test(match[0]))
        return { min: 0, max: parseInt(match[1], 10) };
      if (/\+/.test(match[0]))
        return { min: parseInt(match[1], 10), max: 999 };
      const num = parseInt(match[1], 10);
      return { min: num, max: num };
    }
  }
  return null;
}

function extractCountry(text) {
  const match = text.match(
    /(?:Location|Country):\s*([A-Za-z][A-Za-z\s,]+?)(?:\s*\d|\s*$|\s*\|)/i
  );
  return match ? match[1].trim() : "";
}

/**
 * Build Upwork search URL with pagination.
 */
function buildSearchUrl(pageNum) {
  let baseUrl = config.rss.feedUrl;

  // Ensure it's the search page URL (not RSS, which is dead)
  if (baseUrl.includes("/ab/feed/jobs/")) {
    // Convert RSS URL back to search URL
    baseUrl = baseUrl
      .replace("/ab/feed/jobs/rss", "/nx/search/jobs/")
      .replace("/ab/feed/jobs/atom", "/nx/search/jobs/");
  }

  // Ensure base URL points to search
  if (!baseUrl.includes("/nx/search/jobs")) {
    const url = new URL(baseUrl);
    url.pathname = "/nx/search/jobs/";
    baseUrl = url.toString();
  }

  const url = new URL(baseUrl);
  if (!url.searchParams.has("sort")) {
    url.searchParams.set("sort", "recency");
  }
  if (pageNum > 1) {
    url.searchParams.set("page", pageNum.toString());
  }
  return url.toString();
}

/**
 * Main entry point: fetch and parse Upwork job listings.
 */
async function fetchJobs(scanWindow) {
  const feedUrl = config.rss.feedUrl;
  if (!feedUrl) {
    console.error("UPWORK_RSS_URL is not configured");
    return [];
  }

  console.log(`Fetch method: ${config.fetchMethod}`);
  console.log(`Scan window: Last ${scanWindow.maxAgeMinutes} minutes`);

  const allJobs = [];
  const seenLinks = new Set();
  const maxPages = 5;
  const oldJobThreshold = 4;

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const searchUrl = buildSearchUrl(pageNum);
    console.log(`\nPage ${pageNum}: ${searchUrl.substring(0, 80)}...`);

    let html;
    try {
      html = await fetchHtml(searchUrl);
    } catch (err) {
      console.error(`  Fetch failed: ${err.message}`);
      if (pageNum === 1) {
        // First page failed, try once more
        console.log("  Retrying first page in 5s...");
        await new Promise((r) => setTimeout(r, 5000));
        try {
          html = await fetchHtml(searchUrl);
        } catch (retryErr) {
          console.error(`  Retry failed: ${retryErr.message}`);
          return [];
        }
      } else {
        break;
      }
    }

    if (!html || html.length < 500) {
      console.log("  Received empty or too-short response, stopping");
      break;
    }

    // Check for Cloudflare block
    if (
      html.includes("Challenge - Upwork") ||
      html.includes("Just a moment") ||
      (html.includes("cf-") && html.length < 5000)
    ) {
      console.error(
        "  Cloudflare challenge detected! Switch FETCH_METHOD to scraperapi or flaresolverr."
      );
      return [];
    }

    const jobs = parseJobsFromHtml(html);
    console.log(`  Parsed ${jobs.length} jobs`);

    if (jobs.length === 0) {
      console.log("  No jobs found, stopping pagination");
      break;
    }

    let newJobsCount = 0;
    let oldJobsOnPage = 0;

    for (const job of jobs) {
      if (seenLinks.has(job.link)) continue;
      seenLinks.add(job.link);

      const isWithinWindow = job.pubDate >= scanWindow.from;
      if (isWithinWindow) {
        allJobs.push(job);
        newJobsCount++;
      } else {
        oldJobsOnPage++;
      }
    }

    console.log(
      `  Within window: ${newJobsCount}, Old: ${oldJobsOnPage}`
    );

    if (oldJobsOnPage >= oldJobThreshold) {
      console.log(
        `  ${oldJobsOnPage} old jobs found, stopping pagination`
      );
      break;
    }

    // Delay between pages
    if (pageNum < maxPages) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  allJobs.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  console.log(`\nTotal jobs within scan window: ${allJobs.length}`);
  return allJobs;
}

module.exports = { fetchJobs, parseJobsFromHtml, fetchHtml };
