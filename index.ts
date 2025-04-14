import { ClientHttp2Session, connect, constants } from "node:http2";
import { createServer } from "node:http";

let client2: Record<string, ClientHttp2Session> = {};

function getClient2(key: string) {
  if (client2[key] && !client2[key].destroyed) {
    return client2[key];
  }

  client2[key] = connect(key);

  return client2[key];
}

function ensureSingle<T>(header: T | T[] | undefined) {
  return Array.isArray(header) ? header[0] : header;
}

function ensureMany<T>(header: T | T[] | undefined) {
  return header == null ? [] : Array.isArray(header) ? header : [header];
}

let cookies: string;

let last = 0;

function getCookies() {
  const now = Date.now();

  if (now - last < 240000) {
    return;
  }

  last = now;

  console.log("Reading cookies");

  const clientStream = getClient2("https://www.strava.com").request({
    [constants.HTTP2_HEADER_METHOD]: constants.HTTP2_METHOD_GET,
    [constants.HTTP2_HEADER_PATH]:
      "/maps/global-heatmap?sport=All&style=dark&terrain=false&labels=true&poi=true&cPhotos=true&gColor=blue&gOpacity=100",
    [constants.HTTP2_HEADER_COOKIE]:
      "_strava4_session=eier68hdchci83gf4kb0pre1inqnqvdt",
  });

  clientStream.on("response", (headers) => {
    const status = Number(ensureSingle(headers[constants.HTTP2_HEADER_STATUS]));

    if (status !== 200) {
      console.error("invalid response status");

      process.exit(1);
    }

    cookies = ensureMany(headers[constants.HTTP2_HEADER_SET_COOKIE])
      .map((cookie) => cookie.replace(/;.*/, ""))
      .join("; ");

    clientStream.close();

    console.log("Cookies read");
  });
}

getCookies();

createServer((req, res) => {
  const clientStream = getClient2("https://content-a.strava.com").request({
    [constants.HTTP2_HEADER_METHOD]: constants.HTTP2_METHOD_GET,
    [constants.HTTP2_HEADER_PATH]: "/identified/globalheat" + req.url,
    [constants.HTTP2_HEADER_COOKIE]: cookies,
  });

  clientStream.on("response", (headers) => {
    const status = Number(ensureSingle(headers[constants.HTTP2_HEADER_STATUS]));

    if (status === 403) {
      getCookies();
    }

    console.log(
      status +
        " | " +
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
