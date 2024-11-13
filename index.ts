import { ClientHttp2Session, connect, constants } from "node:http2";
import { createServer } from "node:http";
import { Browser, CookieParam, Page, Protocol, launch } from "puppeteer";
import fs from "fs/promises";

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

async function loadCookies(): Promise<CookieParam[]> {
  console.log("Loading cookies");

  try {
    return JSON.parse(await fs.readFile(COOKIE_PATH, "utf-8"));
  } catch (error) {
    return [];
  }
}

async function loginToStrava(): Promise<
  (CookieParam | Protocol.Network.Cookie)[]
> {
  let browser: Browser | undefined;

  try {
    browser = await launch({
      headless: true,
      devtools: false,
      timeout: 0,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const page: Page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
    );

    await page.setViewport({ width: 1280, height: 800 });

    const cookies = await loadCookies();

    await page.setCookie(...cookies);

    async function tryTile() {
      console.log("Trying the tile...");

      const response = await page.goto(
        "https://heatmap-external-c.strava.com/tiles-auth/all/blue/15/18319/11293.png",
        { waitUntil: "networkidle2" }
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
      waitUntil: "networkidle2",
    });

    if (page.url() === "https://www.strava.com/login") {
      console.log("Redirected to log-in page");

      await page.type("#email", process.env.SP_EMAIL!);
      await page.type("#password", process.env.SP_PASSWORD!);

      await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForNavigation({ waitUntil: "networkidle2" }),
      ]);
    } else {
      console.log("Onboarding: OK");
    }

    if (await tryTile()) {
      return cookies;
    }

    await page.goto("https://www.strava.com/maps/global-heatmap", {
      waitUntil: "networkidle2",
    });

    await page.waitForResponse((response) =>
      response.url().includes("heatmap-external")
    );

    const client = await page.createCDPSession();

    await saveCookies((await client.send("Network.getAllCookies")).cookies);

    return cookies;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

const cookies = await loginToStrava();

let client2: Record<string, ClientHttp2Session> = {};

function getClient2(key: string) {
  return client2[key] && !client2[key].destroyed
    ? client2[key]
    : connect(`https://heatmap-external-${key}.strava.com`);
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
    [constants.HTTP2_HEADER_PATH]: "/tiles-auth" + req.url,
    [constants.HTTP2_HEADER_COOKIE]: cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; "),
  });

  clientStream.on("response", (headers) => {
    const status = Number(ensureSingle(headers[constants.HTTP2_HEADER_STATUS]));

    console.log(
      status +
        ": " +
        (req.socket.address() as any).address +
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
