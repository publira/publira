import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { DataExportState } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDownloadMyDataExport,
  mockGetMyDataExport,
  mockRequestMyDataExport,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockDownloadMyDataExport: vi.fn(),
  mockGetMyDataExport: vi.fn(),
  mockRequestMyDataExport: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      downloadMyDataExport: mockDownloadMyDataExport,
      getMyDataExport: mockGetMyDataExport,
      requestMyDataExport: mockRequestMyDataExport,
    },
  },
  buildSessionHeaders: (accessToken: string) => ({
    headers: { Authorization: `Bearer ${accessToken}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const { getMyDataExport, openMyDataExport, requestMyDataExport } =
  await import("./data-export");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = { headers: { Authorization: "Bearer session-token" } };

const refusal = (code: Code, reason?: string) =>
  new ConnectError(
    "refused",
    code,
    undefined,
    reason
      ? [{ desc: ErrorInfoSchema, value: { domain: "publira", reason } }]
      : undefined
  );

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

const readAll = async (stream: ReadableStream<Uint8Array>) =>
  await new Response(stream).text();

/** The archive {@link openMyDataExport} opens, failing the test on none. */
const openArchive = async (): Promise<ReadableStream<Uint8Array>> => {
  const archive = await openMyDataExport(TENANT_ID);

  if (!archive) {
    throw new Error("No archive was opened.");
  }

  return archive;
};

describe("getMyDataExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("reads a ready archive with the day it is deleted", async () => {
    mockGetMyDataExport.mockResolvedValue({
      dataExport: {
        expiresAt: "2026-11-09T18:00:00Z",
        sizeBytes: 2048n,
        state: DataExportState.READY,
      },
    });

    await expect(getMyDataExport(TENANT_ID)).resolves.toEqual({
      expiresAt: "2026-11-09T18:00:00Z",
      state: "ready",
    });
    expect(mockGetMyDataExport).toHaveBeenCalledWith(
      { tenant: { tenantId: TENANT_ID } },
      SESSION
    );
  });

  it.each([
    [DataExportState.PENDING, { state: "pending" }],
    [DataExportState.FAILED, { state: "failed" }],
    [DataExportState.UNSPECIFIED, null],
  ])("reads state %s", async (state, expected) => {
    mockGetMyDataExport.mockResolvedValue({
      dataExport: { expiresAt: "", sizeBytes: 0n, state },
    });

    await expect(getMyDataExport(TENANT_ID)).resolves.toEqual(expected);
  });

  it("reads no request as none", async () => {
    mockGetMyDataExport.mockResolvedValue({});

    await expect(getMyDataExport(TENANT_ID)).resolves.toBeNull();
  });

  it("asks nothing of the API for a browser with no session", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await expect(getMyDataExport(TENANT_ID)).resolves.toBeNull();
    expect(mockGetMyDataExport).not.toHaveBeenCalled();
  });

  it("lets a failure reach the section's boundary", async () => {
    const failure = refusal(Code.Internal);
    mockGetMyDataExport.mockRejectedValue(failure);

    await expect(getMyDataExport(TENANT_ID)).rejects.toBe(failure);
  });
});

describe("requestMyDataExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("records the request", async () => {
    mockRequestMyDataExport.mockResolvedValue({});

    await expect(requestMyDataExport(TENANT_ID)).resolves.toEqual({
      ok: true,
    });
    expect(mockRequestMyDataExport).toHaveBeenCalledWith(
      { tenant: { tenantId: TENANT_ID } },
      SESSION
    );
  });

  it.each([
    ["DATA_EXPORT_IN_PROGRESS", "in-progress"],
    ["STORAGE_NOT_CONFIGURED", "storage-not-configured"],
  ])("names the %s refusal", async (reason, expected) => {
    mockRequestMyDataExport.mockRejectedValue(
      refusal(Code.FailedPrecondition, reason)
    );

    await expect(requestMyDataExport(TENANT_ID)).resolves.toEqual({
      ok: false,
      refusal: expected,
    });
  });

  it("keeps the disposition of a request past the platform's limit", async () => {
    mockRequestMyDataExport.mockRejectedValue(refusal(Code.ResourceExhausted));

    await expect(requestMyDataExport(TENANT_ID)).resolves.toEqual({
      ok: false,
      refusal: "rate-limited",
    });
  });

  it("rethrows a session the API turns away, for the reauthentication", async () => {
    const failure = refusal(Code.Unauthenticated);
    mockRequestMyDataExport.mockRejectedValue(failure);

    await expect(requestMyDataExport(TENANT_ID)).rejects.toBe(failure);
  });

  it("rethrows a failure it cannot classify", async () => {
    const failure = refusal(Code.Internal);
    mockRequestMyDataExport.mockRejectedValue(failure);

    await expect(requestMyDataExport(TENANT_ID)).rejects.toBe(failure);
  });
});

describe("openMyDataExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("streams every piece of the archive in the order the API sends them", async () => {
    mockDownloadMyDataExport.mockReturnValue(
      serverStream(["PK", "-zip", "-end"])
    );

    await expect(readAll(await openArchive())).resolves.toBe("PK-zip-end");
    expect(mockDownloadMyDataExport).toHaveBeenCalledWith(
      { tenant: { tenantId: TENANT_ID } },
      expect.objectContaining({
        headers: SESSION.headers,
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("answers null when no archive is ready", async () => {
    mockDownloadMyDataExport.mockReturnValue(
      serverStream([], refusal(Code.NotFound))
    );

    await expect(openMyDataExport(TENANT_ID)).resolves.toBeNull();
  });

  it("throws a refusal that comes before the first piece, so the caller can still answer it", async () => {
    const failure = refusal(Code.Unauthenticated);
    mockDownloadMyDataExport.mockReturnValue(serverStream([], failure));

    await expect(openMyDataExport(TENANT_ID)).rejects.toBe(failure);
  });

  it("errors the stream when the API fails halfway through", async () => {
    const failure = refusal(Code.Internal);
    mockDownloadMyDataExport.mockReturnValue(serverStream(["PK"], failure));

    await expect(readAll(await openArchive())).rejects.toBe(failure);
  });

  it("ends the call when the browser gives up on the download", async () => {
    mockDownloadMyDataExport.mockReturnValue(serverStream(["PK", "-zip"]));

    const archive = await openArchive();

    await archive.cancel();

    const [, options] = mockDownloadMyDataExport.mock.calls[0] ?? [];

    expect(options?.signal.aborted).toBe(true);
  });
});
