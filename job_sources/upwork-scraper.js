const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const config = require("../config");

puppeteer.use(StealthPlugin());

const SELECTORS = {
  jobTile:
    '[data-test="job-tile-list"] > div, .job-tile, [data-ev-label="search_results_impression"]',
  jobTitle: 'h2 a, .job-tile-title a, [data-test="job-tile-title-link"]',
  jobLink: 'h2 a, .job-tile-title a, [data-test="job-tile-title-link"]',
  jobDescription: '.job-tile-description, [data-test="job-description-text"]',
  jobBudget: '.js-budget, [data-test="budget"], .budget',
  jobPosted: '.job-tile-posted, [data-test="posted-on"], time',
  jobProposals: '.js-proposals, [data-test="proposals"], .proposals',
  jobSkills: '.air3-token, .skill-badge, [data-test="skill"]',
};

async function createBrowser() {
  const fs = require("fs");

  const chromePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  ];

  let chromePath = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) {
      chromePath = p;
      break;
    }
  }

  if (!chromePath) {
    console.log("Chrome not found, using bundled Chromium");
  } else {
    console.log(`Using Chrome at: ${chromePath}`);
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: chromePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1920,1080",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
    ],
    defaultViewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
  });
  return browser;
}

async function waitForCloudflare(page) {
  let attempts = 0;
  const maxAttempts = 120;
  let hasShownMessage = false;

  while (attempts < maxAttempts) {
    const pageTitle = await page.title();
    const isCloudflare =
      pageTitle.toLowerCase().includes("just a moment") ||
      pageTitle.toLowerCase().includes("checking") ||
      pageTitle.toLowerCase().includes("cloudflare") ||
      pageTitle.toLowerCase().includes("verify");

    if (!isCloudflare) {
      console.log("Cloudflare check passed! Cookies saved for future runs.");
      return true;
    }

    if (!hasShownMessage) {
      console.log("\n==============================================");
      console.log("MANUAL VERIFICATION REQUIRED");
      console.log(
        "Please complete the Cloudflare checkbox in the browser window."
      );
      console.log("Once verified, cookies will be saved for future runs.");
      console.log("==============================================\n");
      hasShownMessage = true;
    }

    if (attempts % 10 === 0) {
      console.log(`Waiting for manual verification... (${attempts}s)`);
    }
    await new Promise((r) => setTimeout(r, 1000));
    attempts++;
  }

  console.log("Cloudflare verification timeout after 2 minutes");
  return false;
}

function parseTimeAgo(timeStr) {
  if (!timeStr) return new Date();

  const now = new Date();
  const lower = timeStr.toLowerCase();

  if (lower.includes("just now") || lower.includes("moments ago")) {
    return now;
  }

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

function parseProposals(text) {
  if (!text) return null;

  const patterns = [
    /(\d+)\s*to\s*(\d+)/i,
    /(\d+)\s*-\s*(\d+)/i,
    /less than\s*(\d+)/i,
    /(\d+)\+/,
    /(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
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

function parseBudget(text) {
  if (!text) return { budget: null, budgetType: "unknown", hourlyRange: null };

  if (/hourly/i.test(text)) {
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

  const fixedMatch = text.match(/\$?([\d,]+)/);
  if (fixedMatch) {
    return {
      budget: parseInt(fixedMatch[1].replace(/,/g, ""), 10),
      budgetType: "fixed",
      hourlyRange: null,
    };
  }

  return { budget: null, budgetType: "unknown", hourlyRange: null };
}

async function scrapeJobsFromPage(page) {
  await page.waitForSelector("body", { timeout: 30000 });

  await waitForCloudflare(page);

  // Wait for page to fully load
  await new Promise((r) => setTimeout(r, 5000));

  // Debug: save screenshot and HTML
  if (config.isDev) {
    const fs = require("fs");
    const path = require("path");
    const debugDir = path.join(config.paths.outputDir, "debug");
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    await page.screenshot({
      path: path.join(debugDir, "page.png"),
      fullPage: true,
    });
    const html = await page.content();
    fs.writeFileSync(path.join(debugDir, "page.html"), html);
    console.log(`Debug files saved to ${debugDir}`);
  }

  try {
    await page.waitForSelector(
      'article, section, [class*="job"], [class*="tile"]',
      { timeout: 10000 }
    );
  } catch (e) {
    console.log("Primary selectors not found, checking page content...");
  }

  // Debug: log page structure
  if (config.isDev) {
    const pageTitle = await page.title();
    console.log(`Page title: ${pageTitle}`);
    const url = page.url();
    console.log(`Current URL: ${url}`);

    const bodyText = await page.evaluate(() => {
      return document.body?.innerText?.substring(0, 500) || "No body text";
    });
    console.log(`Page content preview:\n${bodyText}\n---`);
  }

  const jobs = await page.evaluate(() => {
    const results = [];

    const jobContainers = document.querySelectorAll(
      'article, [data-test="job-tile-list"] > section, [class*="job-tile"]'
    );

    jobContainers.forEach((container) => {
      try {
        const titleEl = container.querySelector(
          'h2 a, h3 a, a[href*="/jobs/"]'
        );
        const title = titleEl?.textContent?.trim() || "";
        const link = titleEl?.href || "";

        const allText = container.innerText || "";

        const descEl = container.querySelector('p, [class*="description"]');
        const description = descEl?.textContent?.trim() || "";

        let budgetText = "";
        const budgetMatch = allText.match(
          /(\$[\d,]+(?:\.\d{2})?(?:\s*-\s*\$[\d,]+(?:\.\d{2})?)?)/
        );
        if (budgetMatch) budgetText = budgetMatch[1];
        if (allText.toLowerCase().includes("hourly")) budgetText += " hourly";

        let postedText = "";
        const timeMatch = allText.match(
          /(\d+\s*(?:minute|hour|day|week|month)s?\s*ago|just now|yesterday)/i
        );
        if (timeMatch) postedText = timeMatch[1];

        let proposalsText = "";
        const proposalPatterns = [
          /Proposals:\s*(\d+\s*to\s*\d+|\d+)/i,
          /(\d+\s*to\s*\d+)\s*proposals/i,
          /(Less than \d+|50\+|\d+)\s*proposals/i,
        ];
        for (const pattern of proposalPatterns) {
          const match = allText.match(pattern);
          if (match) {
            proposalsText = match[1] || match[0];
            break;
          }
        }

        const skillEls = container.querySelectorAll(
          '[class*="token"], [class*="skill"], [class*="badge"]'
        );
        const skills = Array.from(skillEls)
          .map((el) => el.textContent?.trim())
          .filter((s) => s && s.length < 30);

        if (title && link && link.includes("upwork.com")) {
          results.push({
            title,
            link,
            description,
            budgetText,
            postedText,
            proposalsText,
            skills,
          });
        }
      } catch (e) {
        console.error("Error parsing job:", e);
      }
    });

    return results;
  });

  return jobs.map((raw) => {
    const budgetInfo = parseBudget(raw.budgetText);
    return {
      title: raw.title,
      link: raw.link,
      description: raw.description,
      pubDate: parseTimeAgo(raw.postedText),
      ...budgetInfo,
      proposals: parseProposals(raw.proposalsText),
      skills: raw.skills,
      country: "",
    };
  });
}

async function fetchJobDetails(page, job) {
  try {
    await page.goto(job.link, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));

    const details = await page.evaluate(() => {
      const text = document.body?.innerText || "";

      let proposals = null;
      const proposalMatch = text.match(
        /Proposals:\s*(\d+\s*to\s*\d+|\d+|Less than \d+|50\+)/i
      );
      if (proposalMatch) proposals = proposalMatch[1];

      let hires = 0;
      const hiresMatch = text.match(/Hires:\s*(\d+)/i);
      if (hiresMatch) hires = parseInt(hiresMatch[1], 10);

      let clientLocation = null;
      const locationPatterns = [
        /About the client[\s\S]*?([A-Z][a-zA-Z\s]+(?:,\s*[A-Z][a-zA-Z\s]+)?)\s*\d+:\d+\s*[AP]M/,
        /([A-Z][a-zA-Z\s]+)\s*\d+:\d+\s*[AP]M/,
      ];
      for (const pattern of locationPatterns) {
        const match = text.match(pattern);
        if (match) {
          clientLocation = match[1].trim();
          break;
        }
      }

      let clientAvgHourlyRate = null;
      const rateMatch = text.match(/\$([\d.]+)\s*\/hr\s*avg\s*hourly\s*rate/i);
      if (rateMatch) clientAvgHourlyRate = parseFloat(rateMatch[1]);

      let clientTotalSpent = null;
      const spentMatch = text.match(/\$([\d.]+)K?\s*total\s*spent/i);
      if (spentMatch) {
        clientTotalSpent = parseFloat(spentMatch[1]);
        if (text.includes("K total spent")) clientTotalSpent *= 1000;
      }

      let clientHireRate = null;
      const hireRateMatch = text.match(/(\d+)%\s*hire\s*rate/i);
      if (hireRateMatch) clientHireRate = parseInt(hireRateMatch[1], 10);

      const isContractToHire = text.toLowerCase().includes("contract-to-hire");

      let clientRating = null;
      const ratingMatch = text.match(/Rating is ([\d.]+) out of 5/i);
      if (ratingMatch) clientRating = parseFloat(ratingMatch[1]);

      let locationRestrictions = [];
      const locationMatch = text.match(/Location:\s*([^\n]+)/i);
      if (locationMatch) {
        const locs = locationMatch[1]
          .split(",")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        if (
          locs.length > 0 &&
          !locs.some((l) => l.toLowerCase().includes("worldwide"))
        ) {
          locationRestrictions = locs;
        }
      }

      return {
        proposals,
        hires,
        clientLocation,
        clientAvgHourlyRate,
        clientTotalSpent,
        clientHireRate,
        clientRating,
        isContractToHire,
        locationRestrictions,
      };
    });

    if (details.proposals) {
      job.proposals = parseProposals(details.proposals);
    }
    job.hires = details.hires;
    job.clientLocation = details.clientLocation;
    job.clientAvgHourlyRate = details.clientAvgHourlyRate;
    job.clientTotalSpent = details.clientTotalSpent;
    job.clientHireRate = details.clientHireRate;
    job.clientRating = details.clientRating;
    job.isContractToHire = details.isContractToHire;
    job.locationRestrictions = details.locationRestrictions;

    return job;
  } catch (err) {
    console.log(
      `  Error fetching details for: ${job.title.substring(0, 40)}...`
    );
    return job;
  }
}

async function fetchJobs(scanWindow) {
  const searchUrl = config.rss.feedUrl;

  if (!searchUrl) {
    console.error("UPWORK_RSS_URL (search URL) is not configured");
    return [];
  }

  console.log("Starting Upwork scraper with pagination...");
  console.log(`Scan window: Last ${scanWindow.maxAgeHours} hours`);

  let browser;
  try {
    browser = await createBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    });

    let baseUrl = searchUrl;
    if (!baseUrl.includes("sort=recency")) {
      baseUrl += (baseUrl.includes("?") ? "&" : "?") + "sort=recency";
    }

    const allJobs = [];
    const seenLinks = new Set();
    let pageNum = 1;
    const maxPages = 20;
    const oldJobThreshold = 4;

    while (pageNum <= maxPages) {
      const pageUrl = pageNum === 1 ? baseUrl : `${baseUrl}&page=${pageNum}`;
      console.log(`\nScraping page ${pageNum}...`);

      await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 60000 });

      const jobs = await scrapeJobsFromPage(page);
      console.log(`  Found ${jobs.length} jobs on page ${pageNum}`);

      if (jobs.length === 0) {
        console.log("  No more jobs found, stopping pagination");
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
        `  New jobs within 6h: ${newJobsCount}, Old jobs: ${oldJobsOnPage}`
      );

      if (oldJobsOnPage >= oldJobThreshold) {
        console.log(
          `  Found ${oldJobsOnPage} old jobs (>= ${oldJobThreshold}), stopping pagination`
        );
        break;
      }

      pageNum++;
      await new Promise((r) => setTimeout(r, 2000));
    }

    allJobs.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

    console.log(`\nTotal jobs scraped within 6 hours: ${allJobs.length}`);
    console.log(`\nFetching detailed info for each job...`);

    for (let i = 0; i < allJobs.length; i++) {
      const job = allJobs[i];
      console.log(
        `  [${i + 1}/${allJobs.length}] ${job.title.substring(0, 45)}...`
      );
      await fetchJobDetails(page, job);
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(`\nJob details fetched.`);

    if (config.isDev && allJobs.length > 0) {
      console.log("\nFirst 5 jobs with details:");
      allJobs.slice(0, 5).forEach((job, i) => {
        const ageMinutes = Math.round(
          (Date.now() - job.pubDate.getTime()) / 60000
        );
        console.log(`  ${i + 1}. ${job.title.substring(0, 50)}...`);
        console.log(
          `     Posted: ${ageMinutes} min ago | Proposals: ${
            job.proposals ? `${job.proposals.min}-${job.proposals.max}` : "N/A"
          } | Hires: ${job.hires ?? "N/A"}`
        );
        console.log(
          `     Location: ${job.clientLocation || "N/A"} | Client Rate: $${
            job.clientAvgHourlyRate || "N/A"
          }/hr | Contract-to-hire: ${job.isContractToHire ? "Yes" : "No"}`
        );
      });
    }

    return allJobs;
  } catch (err) {
    console.error("Scraper error:", err.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  fetchJobs,
};
