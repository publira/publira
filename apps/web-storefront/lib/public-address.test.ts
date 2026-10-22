import { describe, expect, it } from "vitest";

import { isPublicAddress, resolvePublicAddress } from "./public-address";

describe("isPublicAddress", () => {
  it.each(["203.0.113.7", "8.8.8.8", "2001:4860:4860::8888"])(
    "takes %s for a public address",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    }
  );

  it.each([
    "0.0.0.0",
    "127.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "sgtm.example.com",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("resolvePublicAddress", () => {
  it("answers a public address given as the host", async () => {
    expect(await resolvePublicAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(await resolvePublicAddress("[2001:4860:4860::8888]")).toBe(
      "2001:4860:4860::8888"
    );
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "refuses %s, which has no public address",
    async (hostname) => {
      await expect(resolvePublicAddress(hostname)).rejects.toMatchObject({
        code: "ERESTRICTEDADDRESS",
      });
    }
  );
});
