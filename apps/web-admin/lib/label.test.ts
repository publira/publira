import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAdminPageSession, mockVerifyAdminSession } = vi.hoisted(
  () => ({
    mockVerifyAdminPageSession: vi.fn(() =>
      Promise.resolve({ locale: "en" as const, tenantId: "TENANT001" })
    ),
    mockVerifyAdminSession: vi.fn(),
  })
);

vi.mock("./admin-page-session", () => ({
  verifyAdminPageSession: mockVerifyAdminPageSession,
}));

vi.mock("./auth-session", () => ({
  verifyAdminSession: mockVerifyAdminSession,
}));

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetLabel,
  mockListLabels,
  mockUploadAspectImage,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetLabel: vi.fn(),
  mockListLabels: vi.fn(),
  mockUploadAspectImage: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    label: {
      getLabel: mockGetLabel,
      listLabels: mockListLabels,
      uploadLabelEyeCatchAspectImage: mockUploadAspectImage,
    },
  },
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("listLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("passes the cursor token and the limit through and returns the tokens of the response", async () => {
    mockListLabels.mockResolvedValue({
      labels: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listLabels } = await import("./label");
    const result = await listLabels({ limit: 20, token: "current-page" });

    expect(mockListLabels).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(result).toMatchObject({
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockCacheTag).toHaveBeenCalledWith("labels-TENANT001");
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("fetches the first page with an empty token", async () => {
    mockListLabels.mockResolvedValue({ labels: [] });

    const { listLabels } = await import("./label");
    const result = await listLabels({});

    expect(mockListLabels).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    // A response that names no token still answers with empty strings, so the
    // caller never has to branch on their absence.
    expect(result).toMatchObject({
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("returns the keyset order of the server without re-sorting it", async () => {
    mockListLabels.mockResolvedValue({
      labels: [
        { name: "Zulu", publicId: "LABEL002" },
        { name: "Alpha", publicId: "LABEL001" },
      ],
    });

    const { listLabels } = await import("./label");
    const result = await listLabels({});

    expect(result.labels.map((item) => item.publicId)).toEqual([
      "LABEL002",
      "LABEL001",
    ]);
  });

  it("returns a result with no token when the fetch fails", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockListLabels.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listLabels } = await import("./label");
    const result = await listLabels({ token: "current-page" });

    expect(result).toMatchObject({
      labels: [],
      nextToken: "",
      ok: false,
      previousToken: "",
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("getLabel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("calls GetLabel once instead of walking the list", async () => {
    mockGetLabel.mockResolvedValue({
      label: {
        eyeCatchImageUpdatedAt: "2026-01-02T03:04:05Z",
        eyeCatchImageVariants: [
          {
            contentType: "image/webp",
            fileSizeBytes: 2048,
            height: 512,
            label: "md",
            url: "/images/labels/img/square/512",
            variantType: "square",
            width: 512,
          },
        ],
        name: "Target",
        publicId: "LABEL101",
      },
    });

    const { getLabel } = await import("./label");
    const result = await getLabel({ publicId: "LABEL101" });

    expect(mockGetLabel).toHaveBeenCalledExactlyOnceWith(
      {
        publicId: "LABEL101",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockListLabels).not.toHaveBeenCalled();
    expect(result).toEqual({
      label: {
        eyeCatchImageUpdatedAt: "2026-01-02T03:04:05Z",
        eyeCatchImageVariants: [
          {
            contentType: "image/webp",
            fileSizeBytes: 2048,
            height: 512,
            label: "md",
            url: "/images/labels/img/square/512",
            variantType: "square",
            width: 512,
          },
        ],
        name: "Target",
        publicId: "LABEL101",
      },
      ok: true,
    });
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockCacheTag).toHaveBeenCalledWith("labels-TENANT001");
    expect(mockCacheTag).toHaveBeenCalledWith("label-TENANT001-LABEL101");
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("returns notFound for invalid input without calling the RPC", async () => {
    const { getLabel } = await import("./label");
    const result = await getLabel({ publicId: "   " });

    expect(mockGetLabel).not.toHaveBeenCalled();
    expect(mockCacheTag).not.toHaveBeenCalled();
    expect(result).toEqual({ notFound: true, ok: false });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  // The server answers not_found both for a record that does not exist and
  // for one outside the tenant, so neither is distinguished here: both fall
  // through to notFound.
  it("returns notFound when the RPC answers not_found", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockGetLabel.mockRejectedValue(
      new ConnectError("label not found", Code.NotFound)
    );

    const { getLabel } = await import("./label");
    const result = await getLabel({ publicId: "MISSING" });

    expect(result).toEqual({ notFound: true, ok: false });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("returns a message for a failure other than not_found", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockGetLabel.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getLabel } = await import("./label");
    const result = await getLabel({ publicId: "LABEL001" });

    expect(result.ok).toBe(false);
    expect(result).not.toMatchObject({ notFound: true });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("treats a response with no label as an error", async () => {
    mockGetLabel.mockResolvedValue({});

    const { getLabel } = await import("./label");
    const result = await getLabel({ publicId: "LABEL001" });

    expect(result).toEqual({
      message: "Could not load the labels. Please try again later.",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("listAllLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("follows the cursor past the hundredth entry", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      name: `Label ${String(index + 1).padStart(3, "0")}`,
      publicId: `LABEL${String(index + 1).padStart(3, "0")}`,
    }));
    mockListLabels
      .mockResolvedValueOnce({
        labels: firstPage,
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        labels: [
          { name: "Zebra", publicId: "LABEL101" },
          { name: "Alpha", publicId: "LABEL102" },
        ],
        nextToken: "",
      });

    const { listAllLabels } = await import("./label");
    const result = await listAllLabels();

    expect(mockListLabels).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockListLabels).toHaveBeenNthCalledWith(
      2,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "page-2",
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.labels).toHaveLength(102);
    expect(result.labels.at(0)?.publicId).toBe("LABEL102");
    expect(result.labels.at(-1)?.publicId).toBe("LABEL101");
    expect(result.labels.some((label) => label.publicId === "LABEL101")).toBe(
      true
    );
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockCacheTag).toHaveBeenCalledWith("labels-TENANT001");
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("returns no partial result when nextToken repeats itself", async () => {
    mockListLabels
      .mockResolvedValueOnce({
        labels: Array.from({ length: 100 }, (_, index) => ({
          name: `Label ${index + 1}`,
          publicId: `LABEL${String(index + 1).padStart(3, "0")}`,
        })),
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        labels: [{ name: "Partial", publicId: "LABEL101" }],
        nextToken: "page-2",
      });

    const { listAllLabels } = await import("./label");
    const result = await listAllLabels();

    expect(mockListLabels).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      labels: [],
      message: "Could not load the labels. Please try again later.",
      nextToken: "",
      ok: false,
      previousToken: "",
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("returns no list when a page fails to load", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockListLabels.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listAllLabels } = await import("./label");
    const result = await listAllLabels();

    expect(result).toMatchObject({ labels: [], ok: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("label eye-catch aspect images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("sends the ratio and the image bytes to UploadLabelEyeCatchAspectImage", async () => {
    mockUploadAspectImage.mockResolvedValue({
      label: {
        eyeCatchImageUpdatedAt: "2026-01-02T03:04:05Z",
        eyeCatchImageVariants: [
          {
            contentType: "image/jpeg",
            fileSizeBytes: 4096,
            height: 900,
            label: "landscape_1600w",
            url: "/images/labels/img/landscape/1600",
            variantType: "landscape",
            width: 1600,
          },
        ],
        id: "LABEL101",
        name: "Weekly",
        publicId: "LABEL101",
      },
    });

    const imageData = new Uint8Array([1, 2, 3]);
    const { uploadLabelEyeCatchAspectImage } = await import("./label");
    const result = await uploadLabelEyeCatchAspectImage(
      {
        id: "LABEL101",
        imageContentType: "image/jpeg",
        imageData,
        tenantId: "TENANT001",
        variantType: "landscape",
      },
      "en"
    );

    expect(mockUploadAspectImage).toHaveBeenCalledExactlyOnceWith(
      {
        imageContentType: "image/jpeg",
        imageData,
        labelId: "LABEL101",
        tenant: { tenantId: "TENANT001" },
        variantType: "landscape",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.label.eyeCatchImageVariants[0].variantType).toBe(
        "landscape"
      );
    }
  });

  it("reports a failure when the session is gone", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { uploadLabelEyeCatchAspectImage } = await import("./label");
    const result = await uploadLabelEyeCatchAspectImage(
      {
        id: "LABEL101",
        imageData: new Uint8Array([1]),
        tenantId: "TENANT001",
        variantType: "landscape",
      },
      "en"
    );

    expect(mockUploadAspectImage).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});

describe("the operator check before a shared read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it.each([
    [
      "listLabels",
      async () => {
        const { listLabels } = await import("./label");
        return await listLabels();
      },
      mockListLabels,
    ],
    [
      "listAllLabels",
      async () => {
        const { listAllLabels } = await import("./label");
        return await listAllLabels();
      },
      mockListLabels,
    ],
    [
      "getLabel",
      async () => {
        const { getLabel } = await import("./label");
        return await getLabel({ publicId: "LABEL101" });
      },
      mockGetLabel,
    ],
  ] as const)(
    "%s confirms the operator of the screen's tenant before reading anything",
    async (_, read, rpc) => {
      const redirect = new Error("NEXT_REDIRECT");
      mockVerifyAdminPageSession.mockRejectedValueOnce(redirect);

      await expect(read()).rejects.toBe(redirect);
      expect(rpc).not.toHaveBeenCalled();
    }
  );
});
