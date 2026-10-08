import { once } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import {
  appendPeerAddress,
  appendPeerAddressOnEveryRequest,
} from "./forwarded-hop";

const appended = (
  headers: IncomingHttpHeaders,
  peerAddress?: string
): IncomingHttpHeaders => {
  const copy = { ...headers };
  appendPeerAddress(copy, peerAddress);
  return copy;
};

describe("appendPeerAddress", () => {
  it("appends the address to an X-Forwarded-For that arrived", () => {
    expect(
      appended({ "x-forwarded-for": "203.0.113.7, 198.51.100.4" }, "192.0.2.3")
    ).toEqual({ "x-forwarded-for": "203.0.113.7, 198.51.100.4, 192.0.2.3" });
  });

  it("appends the address to a Forwarded that arrived", () => {
    expect(
      appended({ forwarded: "for=203.0.113.7;proto=https" }, "192.0.2.3")
    ).toEqual({ forwarded: "for=203.0.113.7;proto=https, for=192.0.2.3" });
  });

  it("quotes and brackets an IPv6 address in Forwarded", () => {
    expect(
      appended({ forwarded: 'for="[2001:db8::7]"' }, "2001:db8::3")
    ).toEqual({ forwarded: 'for="[2001:db8::7]", for="[2001:db8::3]"' });
  });

  it("appends the address to each header when both arrived", () => {
    expect(
      appended(
        { forwarded: "for=203.0.113.7", "x-forwarded-for": "198.51.100.4" },
        "192.0.2.3"
      )
    ).toEqual({
      forwarded: "for=203.0.113.7, for=192.0.2.3",
      "x-forwarded-for": "198.51.100.4, 192.0.2.3",
    });
  });

  it("sets X-Forwarded-For to the address alone when neither arrived", () => {
    expect(appended({ host: "example.com" }, "203.0.113.7")).toEqual({
      host: "example.com",
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("treats a blank header as one that did not arrive", () => {
    expect(appended({ "x-forwarded-for": " " }, "203.0.113.7")).toEqual({
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("changes nothing when the socket has no address", () => {
    expect(appended({ forwarded: "for=203.0.113.7" })).toEqual({
      forwarded: "for=203.0.113.7",
    });
  });
});

describe("appendPeerAddressOnEveryRequest", () => {
  it("appends the address before the server's request handler runs", async () => {
    appendPeerAddressOnEveryRequest();
    const server = createServer((req, res) => {
      res.end(
        JSON.stringify({
          forwarded: req.headers.forwarded,
          forwardedFor: req.headers["x-forwarded-for"],
          peerAddress: req.socket.remoteAddress,
        })
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { port } = server.address() as AddressInfo;
      const req = request({
        headers: {
          Forwarded: "for=203.0.113.7",
          "X-Forwarded-For": "198.51.100.4",
        },
        host: "127.0.0.1",
        port,
      });
      req.end();
      const [res] = await once(req, "response");
      let body = "";
      for await (const chunk of res) {
        body += chunk;
      }

      expect(JSON.parse(body)).toEqual({
        forwarded: "for=203.0.113.7, for=127.0.0.1",
        forwardedFor: "198.51.100.4, 127.0.0.1",
        peerAddress: "127.0.0.1",
      });
    } finally {
      server.close();
    }
  });
});
