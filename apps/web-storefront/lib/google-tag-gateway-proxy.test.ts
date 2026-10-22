import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GoogleTagGateway } from "./google-tag-gateway";
import {
  forwardToGoogleTagGateway,
  gatewayRequestHeaders,
  gatewayResponseHeaders,
  GOOGLE_TAG_GATEWAY_URL_ENV,
  isGoogleCookieName,
} from "./google-tag-gateway-proxy";

const GATEWAY_PATH = "_abcdefghijklmnop";

const GOOGLE_GATEWAY: GoogleTagGateway = {
  path: GATEWAY_PATH,
  upstream: { mode: "google", tagId: "GTM-TEST1" },
};

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface Received {
  body: string;
  headers: IncomingHttpHeaders;
  method: string | undefined;
  url: string | undefined;
}

/** An upstream on the loopback that records what reaches it. */
const startUpstream = async (
  respond: (response: ServerResponse) => void
): Promise<{ origin: string; received: Received[] }> => {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        body: Buffer.concat(chunks).toString(),
        headers: request.headers,
        method: request.method,
        url: request.url,
      });
      respond(response);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  closers.push(async () => {
    server.close();
    await once(server, "close");
  });
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, received };
};

/** A listener that only counts the connections opened to it. */
const startListener = async (): Promise<{
  connections: () => number;
  port: number;
}> => {
  let connections = 0;
  const server = createNetServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  server.listen(0);
  await once(server, "listening");
  closers.push(async () => {
    server.close();
    await once(server, "close");
  });
  return {
    connections: () => connections,
    port: (server.address() as AddressInfo).port,
  };
};

const siteRequest = (pathname: string, init?: RequestInit): Request =>
  new Request(`http://store.example${pathname}`, init);

describe("isGoogleCookieName", () => {
  it.each([
    "_ga",
    "_ga_ABC123",
    "_gid",
    "_gat",
    "_gat_gtag_G_ABC123",
    "_gcl_au",
    "_gcl_aw",
    "_gac_UA_1",
    "_dc_gtm_UA_1",
    "FPID",
    "FPLC",
    "FPAU",
    "FPGSID",
    "FPGCLAW",
  ])("takes %s for a Google cookie", (name) => {
    expect(isGoogleCookieName(name)).toBe(true);
  });

  it.each([
    "publira_web_storefront_auth",
    "publira_locale",
    "_gax",
    "ga",
    "fpid",
    "session",
    "",
  ])("does not take %j for one", (name) => {
    expect(isGoogleCookieName(name)).toBe(false);
  });
});

describe("gatewayRequestHeaders", () => {
  it("forwards Google's cookies and the browser's headers, and nothing else", () => {
    expect(
      gatewayRequestHeaders(
        new Headers({
          accept: "*/*",
          authorization: "Bearer reader-token",
          cookie:
            "publira_web_storefront_auth=sealed; _ga=GA1.1.1; publira_locale=en; _ga_ABC=GS1; FPID=fp",
          forwarded: "for=203.0.113.7",
          "sec-ch-ua": '"Chromium";v="140"',
          "user-agent": "Reader/1.0",
          "x-forwarded-countryregion": "JP-13",
          "x-forwarded-for": "198.51.100.1, 10.0.0.2",
          "x-forwarded-host": "store.example",
        }),
        { clientAddress: "203.0.113.7", host: "GTM-TEST1.fps.goog" }
      )
    ).toEqual({
      accept: "*/*",
      cookie: "_ga=GA1.1.1; _ga_ABC=GS1; FPID=fp",
      host: "GTM-TEST1.fps.goog",
      "sec-ch-ua": '"Chromium";v="140"',
      "user-agent": "Reader/1.0",
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("leaves out the cookie and the client address it has none of", () => {
    expect(
      gatewayRequestHeaders(
        new Headers({ cookie: "publira_web_storefront_auth=sealed" }),
        { clientAddress: null, host: "GTM-TEST1.fps.goog" }
      )
    ).toEqual({ host: "GTM-TEST1.fps.goog" });
  });
});

describe("gatewayResponseHeaders", () => {
  it("passes a Set-Cookie for Google's cookies alone, and no header that acts on the site", () => {
    const headers = gatewayResponseHeaders({
      "cache-control": "private, max-age=900",
      "clear-site-data": '"cookies"',
      "content-type": "application/javascript; charset=UTF-8",
      "set-cookie": [
        "FPLC=lc; Path=/; Max-Age=72000; Secure",
        "publira_web_storefront_auth=; Path=/; Max-Age=0",
        "_ga=GA1.1.2; Path=/; Max-Age=63072000",
        "tracker=1; Path=/",
      ],
      "strict-transport-security": "max-age=0",
    });

    expect(headers.getSetCookie()).toEqual([
      "FPLC=lc; Path=/; Max-Age=72000; Secure",
      "_ga=GA1.1.2; Path=/; Max-Age=63072000",
    ]);
    expect(headers.get("content-type")).toBe(
      "application/javascript; charset=UTF-8"
    );
    expect(headers.get("cache-control")).toBe("private, max-age=900");
    expect(headers.has("clear-site-data")).toBe(false);
    expect(headers.has("strict-transport-security")).toBe(false);
  });
});

describe("forwardToGoogleTagGateway", () => {
  it("forwards a hit to Google's gateway under the tag's host, path and query unchanged", async () => {
    const upstream = await startUpstream((response) => {
      response.writeHead(200, {
        "clear-site-data": '"cookies"',
        "content-type": "text/plain",
        "set-cookie": [
          "FPLC=lc; Path=/",
          "publira_web_storefront_auth=; Path=/; Max-Age=0",
        ],
      });
      response.end("ok");
    });
    vi.stubEnv(GOOGLE_TAG_GATEWAY_URL_ENV, upstream.origin);

    const response = await forwardToGoogleTagGateway(
      siteRequest(`/${GATEWAY_PATH}/g/collect?v=2&tid=G-TEST1`, {
        body: "en=page_view",
        headers: {
          authorization: "Bearer reader-token",
          "content-type": "text/plain;charset=UTF-8",
          cookie: "publira_web_storefront_auth=sealed; _ga=GA1.1.1",
          "x-forwarded-countryregion": "JP-13",
        },
        method: "POST",
      }),
      GOOGLE_GATEWAY,
      "203.0.113.7"
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.getSetCookie()).toEqual(["FPLC=lc; Path=/"]);
    expect(response.headers.has("clear-site-data")).toBe(false);

    const [hit] = upstream.received;
    expect(hit).toMatchObject({
      body: "en=page_view",
      method: "POST",
      url: `/${GATEWAY_PATH}/g/collect?v=2&tid=G-TEST1`,
    });
    expect(hit?.headers).toMatchObject({
      "content-type": "text/plain;charset=UTF-8",
      cookie: "_ga=GA1.1.1",
      host: "GTM-TEST1.fps.goog",
      "x-forwarded-for": "203.0.113.7",
    });
    expect(hit?.headers).not.toHaveProperty("authorization");
    expect(hit?.headers).not.toHaveProperty("x-forwarded-countryregion");
  });

  it("passes a redirect back to the browser rather than following it", async () => {
    const upstream = await startUpstream((response) => {
      response.writeHead(302, { location: "https://elsewhere.example/" });
      response.end();
    });
    vi.stubEnv(GOOGLE_TAG_GATEWAY_URL_ENV, upstream.origin);

    const response = await forwardToGoogleTagGateway(
      siteRequest(`/${GATEWAY_PATH}/?id=GTM-TEST1`),
      GOOGLE_GATEWAY,
      null
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://elsewhere.example/");
    expect(upstream.received).toHaveLength(1);
    expect(upstream.received[0]?.headers).not.toHaveProperty("x-forwarded-for");
  });

  it("fails the body of an upstream that goes silent after its headers, and nothing else", async () => {
    const upstream = await startUpstream((response) => {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.write("// the start of a loader");
    });
    vi.stubEnv(GOOGLE_TAG_GATEWAY_URL_ENV, upstream.origin);

    const response = await forwardToGoogleTagGateway(
      siteRequest(`/${GATEWAY_PATH}/?id=GTM-TEST1`),
      GOOGLE_GATEWAY,
      null,
      { idleTimeoutMs: 50 }
    );

    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow();
  });

  it("fails the body when the reader leaves after the headers, and nothing else", async () => {
    const upstream = await startUpstream((response) => {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.write("// the start of a loader");
    });
    vi.stubEnv(GOOGLE_TAG_GATEWAY_URL_ENV, upstream.origin);
    const reader = new AbortController();

    const response = await forwardToGoogleTagGateway(
      siteRequest(`/${GATEWAY_PATH}/?id=GTM-TEST1`, {
        signal: reader.signal,
      }),
      GOOGLE_GATEWAY,
      null
    );
    const body = response.text();
    reader.abort();

    await expect(body).rejects.toThrow();
  });

  it.each([
    ["a host name that resolves to the loopback", "localhost"],
    ["the loopback address", "127.0.0.1"],
  ])(
    "does not connect to a server container on %s",
    async (_label, hostname) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const listener = await startListener();

      const response = await forwardToGoogleTagGateway(
        siteRequest(`/${GATEWAY_PATH}/?id=GTM-TEST1`),
        {
          path: GATEWAY_PATH,
          upstream: {
            mode: "server_container",
            origin: `https://${hostname}:${listener.port}`,
          },
        },
        "203.0.113.7"
      );

      expect(response.status).toBe(502);
      expect(listener.connections()).toBe(0);
    }
  );
});
