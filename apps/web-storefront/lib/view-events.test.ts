import type { RecordContentViewRequest } from "@publira/api-client/public/catalog";
import { ContentViewTargetType } from "@publira/api-client/public/catalog";
import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordContentView, VIEW_ACTOR_COOKIE_NAME } from "./view-events";

const { mockCookies, mockRecordContentView, mockResolveAccessToken } =
  vi.hoisted(() => ({
    mockCookies: vi.fn(),
    mockRecordContentView: vi.fn(),
    mockResolveAccessToken: vi.fn(),
  }));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    contentView: {
      recordContentView: mockRecordContentView,
    },
  },
  buildClientAddressHeaders: () =>
    Promise.resolve({ headers: { Forwarded: CLIENT_FORWARDED } }),
  resolveAccessToken: mockResolveAccessToken,
}));

const CLIENT_FORWARDED = "for=198.51.100.7";
const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const STORED_ACTOR_ID =
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.c2lnbmVkLWJ5LXRoZS1hcGk";

const MINTED_ACTOR_ID =
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc.bWludGVkLWJ5LXRoZS1hcGk";

const cookieStore = (stored?: string) => {
  const set = vi.fn();
  mockCookies.mockResolvedValue({
    get: (name: string) =>
      name === VIEW_ACTOR_COOKIE_NAME && stored !== undefined
        ? { name, value: stored }
        : undefined,
    set,
  });

  return set;
};

interface CallOptions {
  headers: Record<string, string>;
  onHeader?: (header: Headers) => void;
}

/** Answers the RPC with the `Set-Cookie` headers the API would send. */
const respondWith = (...setCookies: string[]) => {
  mockRecordContentView.mockImplementation(
    (_request: RecordContentViewRequest, options: CallOptions) => {
      options.onHeader?.(
        new Headers(setCookies.map((value) => ["set-cookie", value]))
      );

      return Promise.resolve({});
    }
  );
};

const callOptions = (): CallOptions => {
  // SAFETY: `recordContentView` is called with the request and then the call
  // options, whose `headers` the module builds as a plain record.
  const [, options] = mockRecordContentView.mock.calls[0] as [
    unknown,
    CallOptions,
  ];

  return options;
};

const minted = `publira_aid=${MINTED_ACTOR_ID}; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax`;

describe("recordContentView", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue("");
    respondWith();
  });

  it("sends a signed-out reader without an actor with only their address, and keeps the one the API mints", async () => {
    const set = cookieStore();
    respondWith("other=1; Path=/", minted);

    await recordContentView({
      id: "e0000000-0000-4000-8000-000000000001",
      kind: "episode",
      tenantId: TENANT_ID,
    });

    expect(mockRecordContentView).toHaveBeenCalledWith(
      {
        surface: ClientSurface.WEB,
        target: {
          id: "e0000000-0000-4000-8000-000000000001",
          type: ContentViewTargetType.EPISODE,
        },
        tenant: { tenantId: TENANT_ID },
      },
      expect.objectContaining({ headers: { Forwarded: CLIENT_FORWARDED } })
    );

    // SAFETY: the module sets the actor cookie with one options object that
    // names it, its value, and how long it lives.
    const [written] = set.mock.calls[0] as [
      { maxAge: number; name: string; value: string },
    ];

    expect(set).toHaveBeenCalledTimes(1);
    expect(written.name).toBe(VIEW_ACTOR_COOKIE_NAME);
    expect(written.value).toBe(MINTED_ACTOR_ID);
    // Outlives the raw events, and expires rather than living on forever.
    expect(written.maxAge).toBe(180 * 24 * 60 * 60);
  });

  it("forwards the actor the reader already carries and keeps it", async () => {
    const set = cookieStore(STORED_ACTOR_ID);

    await recordContentView({
      id: "5e000000-0000-4000-8000-000000000001",
      kind: "series",
      tenantId: TENANT_ID,
    });

    expect(set).not.toHaveBeenCalled();
    expect(mockRecordContentView).toHaveBeenCalledWith(
      {
        surface: ClientSurface.WEB,
        target: {
          id: "5e000000-0000-4000-8000-000000000001",
          type: ContentViewTargetType.SERIES,
        },
        tenant: { tenantId: TENANT_ID },
      },
      expect.objectContaining({
        headers: {
          Cookie: `publira_aid=${STORED_ACTOR_ID}`,
          Forwarded: CLIENT_FORWARDED,
        },
      })
    );
  });

  // A bare UUID is what this app used to mint itself. The API files no view
  // under an identifier it did not sign, so it answers with one of its own.
  it("replaces a stored actor the API answered with a new one", async () => {
    const set = cookieStore("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    respondWith(minted);

    await recordContentView({
      id: "5e000000-0000-4000-8000-000000000001",
      kind: "series",
      tenantId: TENANT_ID,
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: VIEW_ACTOR_COOKIE_NAME,
        value: MINTED_ACTOR_ID,
      })
    );
  });

  it.each(["has space", "semi;colon", "x".repeat(129)])(
    "does not forward %s, which could not be an identifier the API minted",
    async (stored) => {
      cookieStore(stored);

      await recordContentView({
        id: "5e000000-0000-4000-8000-000000000001",
        kind: "series",
        tenantId: TENANT_ID,
      });

      expect(callOptions().headers).toEqual({ Forwarded: CLIENT_FORWARDED });
    }
  );

  it("sends only the bearer for a signed-in reader and keeps no actor", async () => {
    const set = cookieStore();
    mockResolveAccessToken.mockResolvedValue("header.payload.signature");
    respondWith(minted);

    await recordContentView({
      id: "e0000000-0000-4000-8000-000000000001",
      kind: "episode",
      tenantId: TENANT_ID,
    });

    expect(set).not.toHaveBeenCalled();
    expect(callOptions().headers).toEqual({
      Authorization: "Bearer header.payload.signature",
    });
  });

  it("leaves the reader's page alone when the RPC fails", async () => {
    const set = cookieStore();
    mockRecordContentView.mockRejectedValue(new Error("unavailable"));

    await expect(
      recordContentView({
        id: "e0000000-0000-4000-8000-000000000001",
        kind: "episode",
        tenantId: TENANT_ID,
      })
    ).resolves.toBeUndefined();
    expect(set).not.toHaveBeenCalled();
  });
});
