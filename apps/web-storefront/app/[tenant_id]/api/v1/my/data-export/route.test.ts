import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDownloadMyDataExport,
  mockGetTenantDefaultLocale,
  mockGetTenantSupportedLocales,
  mockRedirect,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockDownloadMyDataExport: vi.fn(),
  mockGetTenantDefaultLocale: vi.fn(),
  mockGetTenantSupportedLocales: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("#lib/api-client", () => ({
  apiClient: { auth: { downloadMyDataExport: mockDownloadMyDataExport } },
  buildSessionHeaders: (accessToken: string) => ({
    headers: { Authorization: `Bearer ${accessToken}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
  sealSessionCookieValue: vi.fn(),
}));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: mockGetTenantDefaultLocale,
  getTenantSupportedLocales: mockGetTenantSupportedLocales,
}));

const { GET } = await import("./route");

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const download = (tenantId = TENANT_ID, query = "") =>
  GET(new Request(`https://site.example.test/api/v1/my/data-export${query}`), {
    params: Promise.resolve({ tenant_id: tenantId }),
  });

/** A server stream that sends `pieces`, then fails with `failure` if given. */
const serverStream = (
  pieces: string[],
  failure?: Error
): AsyncIterable<{ data: Uint8Array }> => ({
  [Symbol.asyncIterator]: () => {
    const queue = pieces.map((piece) => ({
      data: new TextEncoder().encode(piece),
    }));

    return {
      next: () => {
        const value = queue.shift();

        if (value) {
          return Promise.resolve({ done: false, value });
        }

        return failure
          ? Promise.reject(failure)
          : Promise.resolve({ done: true, value: undefined });
      },
    };
  },
});

describe("GET /api/v1/my/data-export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantDefaultLocale.mockResolvedValue("en");
    mockGetTenantSupportedLocales.mockResolvedValue(["en", "ja"]);
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("streams the reader's archive to the browser as a ZIP attachment", async () => {
    mockDownloadMyDataExport.mockReturnValue(serverStream(["PK", "-archive"]));

    const response = await download();

    expect(mockDownloadMyDataExport).toHaveBeenCalledWith(
      { tenant: { tenantId: TENANT_ID } },
      expect.objectContaining({
        headers: { Authorization: "Bearer session-token" },
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="data-export.zip"'
    );
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.text()).resolves.toBe("PK-archive");
  });

  it("sends a reader whose archive expired back to the section, in the language it linked from", async () => {
    mockDownloadMyDataExport.mockReturnValue(
      serverStream([], new ConnectError("gone", Code.NotFound))
    );

    await expect(download(TENANT_ID, "?locale=ja")).rejects.toThrow(
      `NEXT_REDIRECT /ja/settings?${new URLSearchParams({
        message:
          "このデータはダウンロードできなくなりました。新しくリクエストしてください。",
        status: "error",
      })}`
    );
  });

  it("sends a signed-out reader to sign in, coming back to the settings", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await expect(download()).rejects.toThrow(
      "NEXT_REDIRECT /login?returnTo=%2Fsettings&reason=session_revoked"
    );
    expect(mockDownloadMyDataExport).not.toHaveBeenCalled();
  });

  it("sends a reader whose session the API rejects to sign in", async () => {
    mockDownloadMyDataExport.mockReturnValue(
      serverStream([], new ConnectError("expired", Code.Unauthenticated))
    );

    await expect(download()).rejects.toThrow(
      "NEXT_REDIRECT /login?returnTo=%2Fsettings&reason=session_revoked"
    );
  });

  it("answers a path that names no tenant with 404", async () => {
    const response = await download("not-a-tenant");

    expect(response.status).toBe(404);
    expect(mockDownloadMyDataExport).not.toHaveBeenCalled();
  });
});
