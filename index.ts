import { ClientHttp2Session, connect, constants } from "node:http2";
import { createServer } from "node:http";

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
    [constants.HTTP2_HEADER_COOKIE]:
      "sp=0701716b-30bf-4628-9ac9-8294cdd74b9c; CloudFront-Key-Pair-Id=K3VK9UFQYD04PI; CloudFront-Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKmNvbnRlbnQtKi5zdHJhdmEuY29tL2lkZW50aWZpZWQvKiIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc0NDEzMDA0OH19fV19; CloudFront-Signature=XOqHH0ht5dwXIyKPmGgD75qERDdg9rNCYnSsVCiElXM4WDOUomiRn7sJLyHxxyQmsnYEdGg8MX~xIQVuR77UAQz~t12uH~M7BXArsp~~iy8nafABwqFXF8KmRrBZWH6BUHQpwscnnWptU0JerYM7vHO9dOiGH~xBm4XP06l1Kx-H2QLgicKHrT1Od2Az9jdlPwK4-nRDVmc5T38WqISTDZ364DpozDCuBikJEwlzimt9ctgrgQCee-EYyqOTSTjojTUm-eHoV4V52tpY0joDh-P3tIU~nuymLg5zgLq6Y5NbgdOdnkC8IFb07XaNNEO1lEQlY0gezww3DA5ANJhMKQ__; _strava_idcf=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3NDQxMzAwNDgsImlhdCI6MTc0NDA0MzY0OCwiYXRobGV0ZUlkIjoyOTk1ODI0MSwidGltZXN0YW1wIjoxNzQ0MDQzNjQ4fQ.FvlQ7DtsxdlMz3M4CT7K9d9uLFNb2TroONZKcioo89c; _strava_CloudFront-Expires=1744130048000; _strava4_session=anvjef5bblkfgahoi3f9fqv70smpkdno",
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
