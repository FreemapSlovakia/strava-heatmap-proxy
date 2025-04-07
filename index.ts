import { ClientHttp2Session, connect, constants } from "node:http2";
import { createServer } from "node:http";
import { Browser, CookieData, Page, Protocol, launch } from "puppeteer";
import fs from "fs/promises";
import { exit } from "node:process";

const COOKIE_PATH = "./cookies.json";

async function saveCookies(cookies: Protocol.Network.Cookie[]) {
  console.log("Saving cookies");

  await fs.writeFile(
    COOKIE_PATH,
    JSON.stringify(
      cookies.map((cookie) => {
        const { session, partitionKey, size, ...rest } = cookie;

        return rest;
      }),
      null,
      2
    )
  );
}

async function loadCookies(): Promise<CookieData[]> {
  console.log("Loading cookies");

  try {
    return JSON.parse(await fs.readFile(COOKIE_PATH, "utf-8"));
  } catch (error) {
    return [];
  }
}

async function loginToStrava(): Promise<CookieData[]> {
  let browser: Browser | undefined;

  try {
    browser = await launch({
      headless: false,
      devtools: false,
      timeout: 0,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1000,1400",
      ],
    });

    const [page] = await browser.pages();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
    );

    await page.setViewport({ width: 1000, height: 1400 });

    const cookies = await loadCookies();

    await browser.setCookie(...cookies);

    async function tryTile() {
      console.log("Trying the tile...");

      const response = await page.goto(
        "https://content-a.strava.com/identified/globalheat/all/blue/15/5264/12655.png",
        { waitUntil: "networkidle0" }
      );

      const ok = response?.headers()["content-type"].startsWith("image/");

      console.log("Tile: " + (ok ? "OK" : "FAIL"));

      return ok;
    }

    if (await tryTile()) {
      return cookies;
    }

    console.log("Trying the onboarding...");

    await page.goto("https://www.strava.com/onboarding", {
      waitUntil: "networkidle0",
    });

    if (page.url() === "https://www.strava.com/login") {
      console.log("Redirected to log-in page");

      let flash;

      do {
        await page.waitForFunction(() => 'document.readyState === "complete"');

        console.log("Waiting for email input");

        const e = await select(page, "#desktop-email");

        console.log("Entering email");

        await e!.type(process.env.SP_EMAIL!);

        console.log("Pressing enter");

        await page.keyboard.press("Enter");

        console.log("Waiting for result");

        flash = await Promise.race([
          page
            .waitForSelector("div[data-testid=use-password-cta] > button")
            .then(() => false),
          page.waitForSelector("#flashMessage").then(() => true),
        ]);

        console.log("Flash: ", flash);
      } while (flash);

      console.log("Waiting for use password button");

      let btn = await select(
        page,
        "div[data-testid=use-password-cta] > button"
      );

      console.log("Pressing enter");

      await btn?.press("Enter");

      console.log("Typing password");

      let pw = await select(page, "input[type=password]");

      await pw!.type(process.env.SP_PASSWORD!);

      console.log("Submitting");

      await page.keyboard.press("Enter");
    } else {
      console.log("Onboarding: OK");
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));

    // if (await tryTile()) {
    //   return cookies;
    // }

    await page.goto("https://www.strava.com/maps/global-heatmap", {
      waitUntil: "load",
    });

    await page.waitForResponse((response) =>
      response.url().includes("content-a")
    );

    // await new Promise((resolve) => setTimeout(resolve, 10000));

    if (!(await tryTile())) {
      console.error("Can't load tile");

      exit(1);
    }

    // await new Promise((resolve) => setTimeout(resolve, 5000000));

    const client = await page.createCDPSession();

    await saveCookies((await client.send("Network.getAllCookies")).cookies);

    // await new Promise((resolve) => setTimeout(resolve, 500000));

    return cookies;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function select(page: Page, selector: string) {
  await page.waitForSelector(selector);

  const els = await page.$$(selector);

  const visibles = await Promise.all(
    els.map((el) => el.evaluate((el) => el.checkVisibility() as boolean))
  );

  return els[visibles.findIndex((v) => v)];
}

const cookies = await loginToStrava();

let client2: Record<string, ClientHttp2Session> = {};

function getClient2(key: string) {
  return client2[key] && !client2[key].destroyed
    ? client2[key]
    : connect(`https://content-a.strava.com`);
}

function ensureSingle<T>(header: T | T[] | undefined) {
  return Array.isArray(header) ? header[0] : header;
}

const keys = ["a", "b", "c"];

let keyIndex = 0;

createServer((req, res) => {
  keyIndex = (keyIndex + 1) % keys.length;

  const clientStream = getClient2(keys[keyIndex]).request({
    [constants.HTTP2_HEADER_METHOD]: constants.HTTP2_METHOD_GET,
    [constants.HTTP2_HEADER_PATH]: "/identified/globalheat" + req.url,
    [constants.HTTP2_HEADER_COOKIE]: cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; "),
  });

  clientStream.on("response", (headers) => {
    const status = Number(ensureSingle(headers[constants.HTTP2_HEADER_STATUS]));

    console.log(
      status +
        ": " +
        req.headers["x-forwarded-for"] +
        " | " +
        req.headers["referer"] +
        " | " +
        req.headers["user-agent"]
    );

    const ct = ensureSingle(headers[constants.HTTP2_HEADER_CONTENT_TYPE]);

    if (status === 200 && ct && ct?.startsWith("image/")) {
      res.setHeader("Content-Type", ct);
    } else if (status === 404) {
      res.writeHead(404).end();
    } else {
      console.warn(
        Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("|")
      );

      res.writeHead(500).end();
    }
  });

  clientStream.on("error", (err) => {
    console.error(err);

    if (!res.headersSent) {
      res.writeHead(500);
    }

    res.end();
  });

  clientStream.on("data", (chunk) => {
    res.write(chunk);
  });

  clientStream.on("end", () => {
    res.end();
  });

  clientStream.end();
}).listen(Number(process.env.SP_PORT || "8080"));
