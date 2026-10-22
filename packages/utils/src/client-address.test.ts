import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getClientAddress,
  parseTrustedProxies,
  TRUSTED_PROXIES_ENV,
} from "./client-address";
import { FORWARDED_HEADER_ENABLED_ENV } from "./forwarded-header";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getClientAddress", () => {
  it("takes the address the edge set, past the edge the app appended", () => {
    expect(
      getClientAddress(
        new Headers({ "X-Forwarded-For": "203.0.113.7, 172.18.0.5" })
      )
    ).toBe("203.0.113.7");
  });

  it("does not believe what the caller wrote in front of an untrusted hop", () => {
    expect(
      getClientAddress(
        new Headers({
          "X-Forwarded-For": "198.51.100.1, 203.0.113.7, 10.0.0.2",
        })
      )
    ).toBe("203.0.113.7");
  });

  it("reads the for= of Forwarded ahead of X-Forwarded-For", () => {
    expect(
      getClientAddress(
        new Headers({
          Forwarded: 'for="[2001:db8::7]:443";host=store.example, for=10.0.0.2',
          "X-Forwarded-For": "198.51.100.1, 10.0.0.2",
        })
      )
    ).toBe("2001:db8::7");
  });

  it("reads X-Forwarded-For alone when Forwarded is turned off", () => {
    vi.stubEnv(FORWARDED_HEADER_ENABLED_ENV, "false");

    expect(
      getClientAddress(
        new Headers({
          Forwarded: "for=198.51.100.1, for=10.0.0.2",
          "X-Forwarded-For": "203.0.113.7, 10.0.0.2",
        })
      )
    ).toBe("203.0.113.7");
  });

  it("steps over the hops the trusted proxies name, and those alone", () => {
    vi.stubEnv(TRUSTED_PROXIES_ENV, "10.0.0.0/8, 192.0.2.0/24");

    expect(
      getClientAddress(
        new Headers({
          "X-Forwarded-For": "203.0.113.7, 192.0.2.10, 10.0.0.2",
        })
      )
    ).toBe("203.0.113.7");
    expect(
      getClientAddress(
        new Headers({ "X-Forwarded-For": "203.0.113.7, 172.18.0.5" })
      )
    ).toBe("172.18.0.5");
  });

  it("takes the furthest address when every hop is trusted", () => {
    expect(
      getClientAddress(new Headers({ "X-Forwarded-For": "10.0.0.9, ::1" }))
    ).toBe("10.0.0.9");
  });

  it("unmaps an IPv4-mapped peer and skips what is not an address", () => {
    expect(
      getClientAddress(
        new Headers({
          "X-Forwarded-For": "unknown, 203.0.113.7:51234, ::ffff:127.0.0.1",
        })
      )
    ).toBe("203.0.113.7");
    expect(
      getClientAddress(new Headers({ "X-Forwarded-For": "::ffff:cb00:7107" }))
    ).toBe("203.0.113.7");
  });

  it("answers null when no header names an address", () => {
    expect(getClientAddress(new Headers())).toBeNull();
    expect(
      getClientAddress(new Headers({ Forwarded: "for=unknown" }))
    ).toBeNull();
  });
});

describe("parseTrustedProxies", () => {
  it("reads addresses and ranges separated by commas or white space", () => {
    const trusted = parseTrustedProxies(
      "10.0.0.0/8, 203.0.113.7\n2001:db8::/32"
    );

    expect(trusted.check("10.1.2.3", "ipv4")).toBe(true);
    expect(trusted.check("203.0.113.7", "ipv4")).toBe(true);
    expect(trusted.check("203.0.113.8", "ipv4")).toBe(false);
    expect(trusted.check("2001:db8::1", "ipv6")).toBe(true);
  });

  it("reads an IPv4-mapped range as the IPv4 range it maps", () => {
    expect(
      parseTrustedProxies("::ffff:10.0.0.0/104").check("10.9.9.9", "ipv4")
    ).toBe(true);
  });

  it.each([
    "0.0.0.0/0",
    "::/0",
    "::ffff:0.0.0.0/96",
    "::ffff:0:0/95",
    "10.0.0.0/33",
    "10.0.0.0/",
    "fe80::1%eth0",
    "proxy.internal",
  ])("refuses %j", (value) => {
    expect(() => parseTrustedProxies(value)).toThrow(TRUSTED_PROXIES_ENV);
  });
});
