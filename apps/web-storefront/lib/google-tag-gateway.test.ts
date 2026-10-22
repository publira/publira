import { Code, ConnectError } from "@publira/api-client/errors";
import type { PublicApiClient } from "@publira/api-client/public/client";
import { GoogleTagServingMode } from "@publira/api-client/public/types";
import { describe, expect, it, vi } from "vitest";

import {
  createGoogleTagGatewayResolver,
  gatewayPathSegmentOf,
  toGoogleTagGateway,
} from "./google-tag-gateway";

vi.mock("@publira/next-cache-handlers/tags", () => ({
  readTagRevalidatedAt: vi.fn(),
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GATEWAY_PATH = "_abcdefghijklmnop";

const gatewayTag = (
  overrides: Partial<Parameters<typeof toGoogleTagGateway>[0]> = {}
) => ({
  ga4MeasurementId: "G-TEST1",
  gatewayPath: GATEWAY_PATH,
  gtmContainerId: "",
  serverContainerUrl: "",
  servingMode: GoogleTagServingMode.GATEWAY,
  ...overrides,
});

describe("gatewayPathSegmentOf", () => {
  it.each([
    [`/${GATEWAY_PATH}`, GATEWAY_PATH],
    [`/${GATEWAY_PATH}/`, GATEWAY_PATH],
    [`/${GATEWAY_PATH}/g/collect`, GATEWAY_PATH],
    ["/_a2b3c4d5e6f7g7h7", "_a2b3c4d5e6f7g7h7"],
  ])("finds the gateway path in %s", (pathname, expected) => {
    expect(gatewayPathSegmentOf(pathname)).toBe(expected);
  });

  it.each([
    "/",
    "/series",
    "/_next/data/build/index.json",
    `/en/${GATEWAY_PATH}/`,
    "/_abcdefghijklmno",
    "/_abcdefghijklmnopq",
    "/_ABCDEFGHIJKLMNOP",
    "/_abcdefghijklmno1",
  ])("finds none in %s", (pathname) => {
    expect(gatewayPathSegmentOf(pathname)).toBeNull();
  });
});

describe("toGoogleTagGateway", () => {
  it("forwards to Google for the GA4 measurement ID alone", () => {
    expect(toGoogleTagGateway(gatewayTag())).toEqual({
      path: GATEWAY_PATH,
      upstream: { mode: "google", tagId: "G-TEST1" },
    });
  });

  it("forwards to Google for the container when the tenant has both IDs", () => {
    expect(
      toGoogleTagGateway(gatewayTag({ gtmContainerId: "GTM-TEST1" }))
    ).toEqual({
      path: GATEWAY_PATH,
      upstream: { mode: "google", tagId: "GTM-TEST1" },
    });
  });

  it("forwards to the server container when one is set", () => {
    expect(
      toGoogleTagGateway(
        gatewayTag({ serverContainerUrl: "https://sgtm.example.com" })
      )
    ).toEqual({
      path: GATEWAY_PATH,
      upstream: {
        mode: "server_container",
        origin: "https://sgtm.example.com",
      },
    });
  });

  it.each([
    ["no settings", undefined],
    [
      "the Google mode",
      gatewayTag({ servingMode: GoogleTagServingMode.GOOGLE }),
    ],
    [
      "the server container mode",
      gatewayTag({
        serverContainerUrl: "https://sgtm.example.com",
        servingMode: GoogleTagServingMode.SERVER_CONTAINER,
      }),
    ],
    ["no ID", gatewayTag({ ga4MeasurementId: "" })],
    ["no gateway path", gatewayTag({ gatewayPath: "" })],
    ["a path of another shape", gatewayTag({ gatewayPath: "metrics" })],
    [
      "a server container that is not https",
      gatewayTag({ serverContainerUrl: "http://sgtm.example.com" }),
    ],
  ])("answers no gateway for %s", (_label, tag) => {
    expect(toGoogleTagGateway(tag)).toBeNull();
  });
});

/** `revalidatedAt` answering `null` stands for a Redis that cannot be read. */
const setup = (options?: { revalidatedAt?: () => number | null }) => {
  let clock = 1000;
  const getTenantAnalyticsSettings = vi.fn(() =>
    Promise.resolve({ googleTag: gatewayTag() })
  );
  const readRevalidatedAt = vi.fn((_tag: string) => {
    const value = options?.revalidatedAt ? options.revalidatedAt() : 0;
    return Promise.resolve(value ?? undefined);
  });
  const resolve = createGoogleTagGatewayResolver(
    { tenant: { getTenantAnalyticsSettings } } as unknown as PublicApiClient,
    { now: () => clock, readRevalidatedAt }
  );
  return {
    advance: (ms: number) => {
      clock += ms;
    },
    getTenantAnalyticsSettings,
    now: () => clock,
    readRevalidatedAt,
    resolve,
  };
};

describe("createGoogleTagGatewayResolver", () => {
  it("reads a tenant's gateway once and serves it from memory", async () => {
    const { getTenantAnalyticsSettings, readRevalidatedAt, resolve } = setup();

    expect(await resolve(TENANT_ID)).toMatchObject({ path: GATEWAY_PATH });
    expect(await resolve(TENANT_ID)).toMatchObject({ path: GATEWAY_PATH });

    expect(getTenantAnalyticsSettings).toHaveBeenCalledExactlyOnceWith({
      tenant: { tenantId: TENANT_ID },
    });
    expect(readRevalidatedAt).toHaveBeenCalledWith(
      `tenant:${TENANT_ID}:analytics-settings`
    );
  });

  it("drops a regenerated path once the settings tag is revalidated", async () => {
    let revalidatedAt: number | null = 0;
    const { advance, getTenantAnalyticsSettings, now, resolve } = setup({
      revalidatedAt: () => revalidatedAt,
    });

    await resolve(TENANT_ID);
    advance(10);
    revalidatedAt = now();
    getTenantAnalyticsSettings.mockResolvedValueOnce({
      googleTag: gatewayTag({ gatewayPath: "_qrstuvwxyz234567" }),
    });
    advance(10);

    expect(await resolve(TENANT_ID)).toMatchObject({
      path: "_qrstuvwxyz234567",
    });
    expect(getTenantAnalyticsSettings).toHaveBeenCalledTimes(2);
  });

  it("answers no gateway once the tenant leaves the gateway mode", async () => {
    let revalidatedAt: number | null = 0;
    const { advance, getTenantAnalyticsSettings, now, resolve } = setup({
      revalidatedAt: () => revalidatedAt,
    });

    await resolve(TENANT_ID);
    advance(10);
    revalidatedAt = now();
    getTenantAnalyticsSettings.mockResolvedValueOnce({
      googleTag: gatewayTag({ servingMode: GoogleTagServingMode.GOOGLE }),
    });
    advance(10);

    expect(await resolve(TENANT_ID)).toBeNull();
  });

  it("keeps the gateway it holds when the read fails", async () => {
    let revalidatedAt: number | null = 0;
    const { advance, getTenantAnalyticsSettings, now, resolve } = setup({
      revalidatedAt: () => revalidatedAt,
    });

    await resolve(TENANT_ID);
    advance(10);
    revalidatedAt = now();
    getTenantAnalyticsSettings.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );
    advance(10);

    expect(await resolve(TENANT_ID)).toMatchObject({ path: GATEWAY_PATH });
  });

  it.each([
    ["an internal error", new ConnectError("broken", Code.Internal)],
    ["an unimplemented RPC", new ConnectError("missing", Code.Unimplemented)],
    ["a throw that is not an RPC error", new TypeError("bad mapping")],
  ])(
    "rejects with %s rather than answering no gateway",
    async (_label, error) => {
      const { getTenantAnalyticsSettings, resolve } = setup();
      getTenantAnalyticsSettings.mockRejectedValueOnce(error);

      await expect(resolve(TENANT_ID)).rejects.toBe(error);
    }
  );

  it("shares one read between concurrent requests", async () => {
    const { getTenantAnalyticsSettings, resolve } = setup();

    await Promise.all([resolve(TENANT_ID), resolve(TENANT_ID)]);

    expect(getTenantAnalyticsSettings).toHaveBeenCalledOnce();
  });
});
