import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertSameOrigin, mockUpdateAssociation, mockUpdateTag } =
  vi.hoisted(() => ({
    mockAssertSameOrigin: vi.fn(),
    mockUpdateAssociation: vi.fn(),
    mockUpdateTag: vi.fn(),
  }));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth-session", () => ({
  withAdminSessionReauth: (run: () => unknown) => run(),
}));

vi.mock("#lib/tenant-mobile-app-association", () => ({
  MAX_ANDROID_CERT_FINGERPRINTS: 10,
  tenantMobileAppAssociationCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:mobile-app-association`,
  updateTenantMobileAppAssociation: mockUpdateAssociation,
}));

const FINGERPRINT_A = Array.from({ length: 32 }, () => "AA").join(":");
const FINGERPRINT_B = Array.from({ length: 32 }, () => "0b").join(":");

const formData = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  data.set("tenant_id", "TENANT001");
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

const android = {
  android_application_id: " com.example.reader ",
  android_enabled: "on",
  android_fingerprints: `${FINGERPRINT_A}\n\n  ${FINGERPRINT_B}  \n`,
};

const ios = {
  ios_bundle_identifier: "com.example.reader",
  ios_enabled: "on",
  ios_team_id: " abcde12345 ",
};

describe("updateAppLinksAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockUpdateAssociation.mockResolvedValue({ association: {}, ok: true });
  });

  it("sends both platforms normalized and clears the settings read", async () => {
    const { updateAppLinksAction } = await import("./actions");

    const result = await updateAppLinksAction(
      null,
      formData({ ...android, ...ios })
    );

    expect(result).toEqual({ message: "The app links were saved.", ok: true });
    expect(mockUpdateAssociation).toHaveBeenCalledWith(
      {
        association: {
          android: {
            applicationId: "com.example.reader",
            sha256CertFingerprints: [
              FINGERPRINT_A,
              FINGERPRINT_B.toUpperCase(),
            ],
          },
          ios: { bundleIdentifier: "com.example.reader", teamId: "ABCDE12345" },
        },
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:mobile-app-association"
    );
  });

  // A disabled field submits nothing, so an unticked platform arrives as no
  // fields at all.
  it("clears a platform whose box is unticked", async () => {
    const { updateAppLinksAction } = await import("./actions");

    await updateAppLinksAction(null, formData(ios));

    expect(mockUpdateAssociation).toHaveBeenCalledWith(
      {
        association: {
          android: undefined,
          ios: { bundleIdentifier: "com.example.reader", teamId: "ABCDE12345" },
        },
        tenantId: "TENANT001",
      },
      "en"
    );
  });

  it.each([
    [
      "an application ID with one part",
      { ...android, android_application_id: "reader" },
      "Enter the application ID as two or more dot-separated parts, such as com.example.reader. Each part starts with a letter and holds only letters, digits, and underscores.",
    ],
    [
      "no fingerprint",
      { ...android, android_fingerprints: "\n" },
      "Enter from 1 to 10 SHA-256 certificate fingerprints, one per line.",
    ],
    [
      "a fingerprint that is not SHA-256",
      { ...android, android_fingerprints: "AA:BB:CC" },
      "Not a SHA-256 certificate fingerprint: AA:BB:CC. Enter each as 32 colon-separated hex bytes (AA:BB:…).",
    ],
    [
      "a fingerprint listed twice",
      {
        ...android,
        android_fingerprints: `${FINGERPRINT_A}\n${FINGERPRINT_A.toLowerCase()}`,
      },
      `A certificate fingerprint is listed twice: ${FINGERPRINT_A}`,
    ],
    [
      "a Team ID of the wrong length",
      { ...ios, ios_team_id: "ABCDE" },
      "Enter the Team ID as ten letters and digits, such as ABCDE12345.",
    ],
    [
      "a bundle identifier with one part",
      { ...ios, ios_bundle_identifier: "reader" },
      "Enter the bundle identifier as two or more dot-separated parts of letters, digits, and hyphens, such as com.example.reader.",
    ],
  ])("refuses %s before calling the API", async (_, fields, message) => {
    const { updateAppLinksAction } = await import("./actions");

    const result = await updateAppLinksAction(null, formData(fields));

    expect(result).toEqual({ message, ok: false });
    expect(mockUpdateAssociation).not.toHaveBeenCalled();
  });

  it("returns the API's refusal and keeps the settings read", async () => {
    mockUpdateAssociation.mockResolvedValueOnce({
      message: "Could not save the app links. Please try again later.",
      ok: false,
    });
    const { updateAppLinksAction } = await import("./actions");

    const result = await updateAppLinksAction(null, formData(ios));

    expect(result).toEqual({
      message: "Could not save the app links. Please try again later.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
