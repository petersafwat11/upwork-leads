const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const config = require("../config");

puppeteer.use(StealthPlugin());

const COOKIES_PATH = path.join(config.paths.dataDir, "cookies.json");

let browserInstance = null;
let lastBrowserUse = 0;
const BROWSER_IDLE_TIMEOUT = 5 * 60 * 1000;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    lastBrowserUse = Date.now();
    return browserInstance;
  }

  console.log("  Launching browser...");

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1920,1080",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--lang=en-US,en",
    "--start-maximized",
  ];

  const useHeadless = process.env.BROWSER_HEADLESS === "true";

  const launchOptions = {
    headless: useHeadless ? "new" : false,
    args,
    defaultViewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    protocolTimeout: 120000,
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  browserInstance = await puppeteer.launch(launchOptions);
  lastBrowserUse = Date.now();

  const idleCheck = setInterval(() => {
    if (Date.now() - lastBrowserUse > BROWSER_IDLE_TIMEOUT) {
      clearInterval(idleCheck);
      closeBrowser();
    }
  }, 30000);

  return browserInstance;
}

async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch (e) {}
    browserInstance = null;
    console.log("  Browser closed");
  }
}

function loadCookies() {
  try {
    if (fs.existsSync(COOKIES_PATH)) {
      const data = fs.readFileSync(COOKIES_PATH, "utf8");
      const parsed = JSON.parse(data);
      if (parsed._savedAt && Date.now() - parsed._savedAt < 2 * 60 * 60 * 1000) {
        return parsed.cookies || [];
      }
    }
  } catch (e) {}
  return [];
}

function saveCookies(cookies) {
  try {
    const dir = path.dirname(COOKIES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      COOKIES_PATH,
      JSON.stringify({ cookies, _savedAt: Date.now() }, null, 2)
    );
  } catch (e) {}
}

/**
 * Simulate human-like mouse movements on the page.
 */
async function simulateHuman(page) {
  try {
    // Move mouse to random positions
    const moves = [
      [400, 300],
      [600, 400],
      [300, 500],
      [700, 350],
      [500, 450],
    ];
    for (const [x, y] of moves) {
      await page.mouse.move(x, y, { steps: 5 });
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
    }
  } catch (e) {}
}

/**
 * Try to click Cloudflare's challenge checkbox/button.
 */
async function tryClickChallenge(page) {
  try {
    // Cloudflare Turnstile checkbox
    const selectors = [
      'input[type="checkbox"]',
      "#challenge-stage",
      'iframe[src*="challenges"]',
      ".cf-turnstile",
      '[id*="turnstile"]',
    ];

    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        const box = await el.boundingBox();
        if (box) {
          // Click center of the element with slight randomness
          await page.mouse.click(
            box.x + box.width / 2 + (Math.random() * 4 - 2),
            box.y + box.height / 2 + (Math.random() * 4 - 2),
            { delay: 50 + Math.random() * 100 }
          );
          console.log(`  Clicked challenge element: ${sel}`);
          return true;
        }
      }
    }

    // Try clicking inside Cloudflare iframe
    const frames = page.frames();
    for (const frame of frames) {
      const frameUrl = frame.url();
      if (
        frameUrl.includes("challenges") ||
        frameUrl.includes("turnstile") ||
        frameUrl.includes("cloudflare")
      ) {
        try {
          const checkbox = await frame.$('input[type="checkbox"], .cb-i, .mark');
          if (checkbox) {
            await checkbox.click({ delay: 50 + Math.random() * 100 });
            console.log("  Clicked checkbox inside Cloudflare iframe");
            return true;
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return false;
}

/**
 * Wait for Cloudflare challenge to resolve.
 */
async function waitForCloudflare(page, maxWaitMs = 60000) {
  const startTime = Date.now();
  let clickAttempted = false;

  while (Date.now() - startTime < maxWaitMs) {
    const title = await page.title().catch(() => "");

    const isChallenge =
      title.toLowerCase().includes("just a moment") ||
      title.toLowerCase().includes("challenge") ||
      title.toLowerCase().includes("checking") ||
      title.toLowerCase().includes("verify");

    if (!isChallenge) {
      return true;
    }

    // After 5 seconds, simulate human + try clicking challenge
    if (!clickAttempted && Date.now() - startTime > 5000) {
      await simulateHuman(page);
      await tryClickChallenge(page);
      clickAttempted = true;
    }

    // After 15 seconds, try clicking again
    if (Date.now() - startTime > 15000 && Date.now() - startTime < 17000) {
      await tryClickChallenge(page);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  return false;
}

async function fetchHtml(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    });

    // Load saved cookies
    const savedCookies = loadCookies();
    if (savedCookies.length > 0) {
      await page.setCookie(...savedCookies);
      console.log(`  Loaded ${savedCookies.length} saved cookies`);
    }

    console.log("  Navigating...");
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait for Cloudflare
    const passed = await waitForCloudflare(page);

    if (!passed) {
      const title = await page.title().catch(() => "unknown");
      throw new Error(
        `Cloudflare challenge stuck (title: "${title}"). On Railway this works via Xvfb. Locally try FETCH_METHOD=flaresolverr.`
      );
    }

    console.log("  Cloudflare passed!");

    // Wait for content to render
    await new Promise((r) => setTimeout(r, 4000));

    // Scroll down to trigger lazy loading
    await page.evaluate(() => window.scrollBy(0, 500));
    await new Promise((r) => setTimeout(r, 1000));

    // Save cookies
    const cookies = await page.cookies();
    saveCookies(cookies);

    const html = await page.content();
    lastBrowserUse = Date.now();
    return html;
  } finally {
    await page.close().catch(() => {});
  }
}

process.on("exit", () => closeBrowser());
process.on("SIGINT", () => closeBrowser().then(() => process.exit()));
process.on("SIGTERM", () => closeBrowser().then(() => process.exit()));

module.exports = { fetchHtml, closeBrowser };
