import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantMobileAppAssociationApi,
  mockUpdateTenantMobileAppAssociationApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantMobileAppAssociationApi: vi.fn(),
  mockUpdateTenantMobileAppAssociationApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    tenantSettings: {
      getTenantMobileAppAssociation: mockGetTenantMobileAppAssociationApi,
      updateTenantMobileAppAssociation: mockUpdateTenantMobileAppAssociationApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const FINGERPRINT_A = Array.from({ length: 32 }, () => "AA").join(":");
const FINGERPRINT_B = Array.from({ length: 32 }, () => "BB").join(":");

const fieldViolation = (field: string) =>
  new ConnectError("rejected", Code.InvalidArgument, undefined, [
    { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
  ]);

describe("tenant-mobile-app-association", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads both platforms under the tenant's tag", async () => {
    mockGetTenantMobileAppAssociationApi.mockResolvedValueOnce({
      association: {
        android: {
          applicationId: "com.example.reader",
          sha256CertFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
        },
        ios: { bundleIdentifier: "com.example.reader", teamId: "ABCDE12345" },
      },
    });

    const { getTenantMobileAppAssociation } =
      await import("./tenant-mobile-app-association");
    const result = await getTenantMobileAppAssociation("TENANT001", "en");

    expect(result).toEqual({
      association: {
        android: {
          applicationId: "com.example.reader",
          sha256CertFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
        },
        ios: { bundleIdentifier: "com.example.reader", teamId: "ABCDE12345" },
      },
      ok: true,
    });
    expect(mockGetTenantMobileAppAssociationApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:mobile-app-association"
    );
  });

  it("reads a tenant with no app as having neither platform", async () => {
    mockGetTenantMobileAppAssociationApi.mockResolvedValueOnce({
      association: {},
    });

    const { getTenantMobileAppAssociation } =
      await import("./tenant-mobile-app-association");
    const result = await getTenantMobileAppAssociation("TENANT001", "en");

    expect(result).toEqual({
      association: { android: undefined, ios: undefined },
      ok: true,
    });
  });

  it("asks for a sign-in when there is no session", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");

    const { getTenantMobileAppAssociation } =
      await import("./tenant-mobile-app-association");
    const result = await getTenantMobileAppAssociation("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockGetTenantMobileAppAssociationApi).not.toHaveBeenCalled();
  });

  it("reports a read the API could not answer", async () => {
    mockGetTenantMobileAppAssociationApi.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    const { getTenantMobileAppAssociation } =
      await import("./tenant-mobile-app-association");
    const result = await getTenantMobileAppAssociation("TENANT001", "en");

    expect(result).toMatchObject({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });

  it("writes an absent platform as absent, which clears it", async () => {
    mockUpdateTenantMobileAppAssociationApi.mockResolvedValueOnce({
      association: {
        ios: { bundleIdentifier: "com.example.reader", teamId: "ABCDE12345" },
      },
    });

    const { updateTenantMobileAppAssociation } =
      await import("./tenant-mobile-app-association");
    const result = await updateTenantMobileAppAssociation(
      {
        association: {
          ios: { bundleIdentifier: "com.example.reader", teamId: "ABCDE12345" },
        },
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toMatchObject({ ok: true });
    expect(mockUpdateTenantMobileAppAssociationApi).toHaveBeenCalledWith(
      {
        association: {
          android: undefined,
          ios: { bundleIdentifier: "com.example.reader", teamId: "ABCDE12345" },
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it.each([
    [
      "association.android.application_id",
      "Enter the application ID as two or more dot-separated parts, such as com.example.reader. Each part starts with a letter and holds only letters, digits, and underscores.",
    ],
    [
      "association.android.sha256_cert_fingerprints",
      "Enter from 1 to 10 SHA-256 certificate fingerprints, one per line.",
    ],
    [
      "association.android.sha256_cert_fingerprints[1]",
      `The certificate fingerprint was refused: ${FINGERPRINT_B}. Enter each fingerprint once, as 32 colon-separated hex bytes.`,
    ],
    [
      "association.ios.team_id",
      "Enter the Team ID as ten letters and digits, such as ABCDE12345.",
    ],
    [
      "association.ios.bundle_identifier",
      "Enter the bundle identifier as two or more dot-separated parts of letters, digits, and hyphens, such as com.example.reader.",
    ],
  ])("names the field the API refused (%s)", async (field, message) => {
    mockUpdateTenantMobileAppAssociationApi.mockRejectedValueOnce(
      fieldViolation(field)
    );

    const { updateTenantMobileAppAssociation } =
      await import("./tenant-mobile-app-association");
    const result = await updateTenantMobileAppAssociation(
      {
        association: {
          android: {
            applicationId: "com.example.reader",
            sha256CertFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
          },
          ios: { bundleIdentifier: "com.example.reader", teamId: "ABCDE12345" },
        },
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ message, ok: false });
  });

  it("tells an operator who is not a tenant admin that the save was refused", async () => {
    mockUpdateTenantMobileAppAssociationApi.mockRejectedValueOnce(
      new ConnectError("tenant admin required", Code.PermissionDenied)
    );

    const { updateTenantMobileAppAssociation } =
      await import("./tenant-mobile-app-association");
    const result = await updateTenantMobileAppAssociation(
      { association: {}, tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
    });
  });
});
