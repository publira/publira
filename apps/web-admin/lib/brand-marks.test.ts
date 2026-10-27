import { TenantBrandMarkKind } from "@publira/api-client/admin/types";
import {
  BadRequestSchema,
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockDeleteTenantBrandMarkApi,
  mockGetSessionId,
  mockListTenantBrandMarksApi,
  mockUploadTenantBrandMarkApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockDeleteTenantBrandMarkApi: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockListTenantBrandMarksApi: vi.fn(),
  mockUploadTenantBrandMarkApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    brandMarks: {
      deleteTenantBrandMark: mockDeleteTenantBrandMarkApi,
      listTenantBrandMarks: mockListTenantBrandMarksApi,
      uploadTenantBrandMark: mockUploadTenantBrandMarkApi,
    },
  }),
}));

const acceptedAt = "2026-10-20T03:04:05Z";
const termsUrl = "https://example.com/brand/guidelines";

/** The API answer for a stored mark, as the console reads it. */
const storedMarkResponse = (
  kind: TenantBrandMarkKind,
  variantType: string,
  acceptedBy = "Example Admin"
) => ({
  mark: {
    imageUpdatedAt: acceptedAt,
    imageVariants: [
      {
        contentType: "image/png",
        fileSizeBytes: 2048n,
        height: 40,
        label: "original",
        url: `/images/tenants/media-1/${variantType}`,
        variantType,
        width: 120,
      },
    ],
    kind,
    termsAcceptedAt: acceptedAt,
    termsUrl,
  },
  termsAcceptedByUserName: acceptedBy,
  termsAcceptedByUserPublicId: acceptedBy ? "user-1" : "",
});

/** What the mapper has to produce from it. */
const storedMark = (
  kind: string,
  variantType: string,
  termsAcceptedByName = "Example Admin"
) => ({
  image: {
    updatedAt: acceptedAt,
    variants: [
      {
        contentType: "image/png",
        fileSizeBytes: 2048,
        height: 40,
        label: "original",
        url: `/images/tenants/media-1/${variantType}`,
        variantType,
        width: 120,
      },
    ],
  },
  kind,
  termsAcceptedAt: acceptedAt,
  termsAcceptedByName,
  termsUrl,
});

describe("brand-marks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("keys the uploaded marks by their kind under the screen's cache tag", async () => {
    mockListTenantBrandMarksApi.mockResolvedValueOnce({
      brandMarks: [
        storedMarkResponse(TenantBrandMarkKind.X_SHARE, "x_share"),
        storedMarkResponse(
          TenantBrandMarkKind.GOOGLE_SIGN_IN,
          "google_sign_in",
          ""
        ),
      ],
    });

    const { getTenantBrandMarks } = await import("./brand-marks");

    const result = await getTenantBrandMarks("TENANT001", "en");

    expect(result).toEqual({
      marks: {
        google_sign_in: storedMark("google_sign_in", "google_sign_in", ""),
        x_share: storedMark("x_share", "x_share"),
      },
      ok: true,
    });
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:brand-marks");
    expect(mockListTenantBrandMarksApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  // A kind added to the API before the console knows its name has no card to
  // land on, and a mark whose image did not arrive has nothing to show.
  it("leaves out a kind it does not know and a mark without an image", async () => {
    const withoutImage = storedMarkResponse(
      TenantBrandMarkKind.LINE_SHARE,
      "line_share"
    );
    mockListTenantBrandMarksApi.mockResolvedValueOnce({
      brandMarks: [
        storedMarkResponse(99 as TenantBrandMarkKind, "future_mark"),
        { ...withoutImage, mark: { ...withoutImage.mark, imageVariants: [] } },
      ],
    });

    const { getTenantBrandMarks } = await import("./brand-marks");

    expect(await getTenantBrandMarks("TENANT001", "en")).toEqual({
      marks: {},
      ok: true,
    });
  });

  it("reports the read without a session as one that needs signing in", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { getTenantBrandMarks } = await import("./brand-marks");

    expect(await getTenantBrandMarks("TENANT001", "en")).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockListTenantBrandMarksApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed read without caching it", async () => {
    mockListTenantBrandMarksApi.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );

    const { getTenantBrandMarks } = await import("./brand-marks");

    expect(await getTenantBrandMarks("TENANT001", "en")).toMatchObject({
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("uploads with the guidelines it was given and their acceptance", async () => {
    mockUploadTenantBrandMarkApi.mockResolvedValueOnce({
      brandMark: storedMarkResponse(
        TenantBrandMarkKind.APP_STORE_BADGE,
        "app_store_badge"
      ),
    });

    const { uploadTenantBrandMark } = await import("./brand-marks");

    const imageData = new Uint8Array([1, 2, 3]);
    const result = await uploadTenantBrandMark(
      {
        imageContentType: "image/png",
        imageData,
        kind: "app_store_badge",
        tenantId: "TENANT001",
        termsUrl,
      },
      "en"
    );

    expect(result).toEqual({
      mark: storedMark("app_store_badge", "app_store_badge"),
      ok: true,
    });
    expect(mockUploadTenantBrandMarkApi).toHaveBeenCalledWith(
      {
        imageContentType: "image/png",
        imageData,
        kind: TenantBrandMarkKind.APP_STORE_BADGE,
        tenant: { tenantId: "TENANT001" },
        termsAccepted: true,
        termsUrl,
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words an image the API could not read", async () => {
    mockUploadTenantBrandMarkApi.mockRejectedValueOnce(
      new ConnectError(
        "image: unknown format",
        Code.InvalidArgument,
        undefined,
        [
          {
            desc: BadRequestSchema,
            value: { fieldViolations: [{ field: "image_data" }] },
          },
        ]
      )
    );

    const { uploadTenantBrandMark } = await import("./brand-marks");

    expect(
      await uploadTenantBrandMark(
        {
          imageContentType: "image/png",
          imageData: new Uint8Array([1]),
          kind: "x_share",
          tenantId: "TENANT001",
          termsUrl,
        },
        "en"
      )
    ).toEqual({
      message:
        "The image could not be read. Choose a JPEG, PNG, or WebP image.",
      ok: false,
    });
  });

  it("words an upload the API refused for want of the acceptance", async () => {
    mockUploadTenantBrandMarkApi.mockRejectedValueOnce(
      new ConnectError(
        "terms not accepted",
        Code.FailedPrecondition,
        undefined,
        [
          {
            desc: ErrorInfoSchema,
            value: {
              domain: "publira",
              reason: "BRAND_MARK_TERMS_NOT_ACCEPTED",
            },
          },
        ]
      )
    );

    const { uploadTenantBrandMark } = await import("./brand-marks");

    expect(
      await uploadTenantBrandMark(
        {
          imageContentType: "image/png",
          imageData: new Uint8Array([1]),
          kind: "x_share",
          tenantId: "TENANT001",
          termsUrl,
        },
        "en"
      )
    ).toEqual({
      message: "Accept the owner's guidelines before you upload the mark.",
      ok: false,
    });
  });

  it("deletes the mark of the kind it was given", async () => {
    mockDeleteTenantBrandMarkApi.mockResolvedValueOnce({});

    const { deleteTenantBrandMark } = await import("./brand-marks");

    expect(
      await deleteTenantBrandMark("TENANT001", "google_play_badge", "en")
    ).toEqual({ mark: null, ok: true });
    expect(mockDeleteTenantBrandMarkApi).toHaveBeenCalledWith(
      {
        kind: TenantBrandMarkKind.GOOGLE_PLAY_BADGE,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});
