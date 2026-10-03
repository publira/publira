import { Code, ConnectError } from "@publira/api-client/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAssociation } = vi.hoisted(() => ({
  mockGetAssociation: vi.fn(),
}));

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

vi.mock("#lib/api-client", () => ({
  apiClient: {
    tenant: { getTenantMobileAppAssociation: mockGetAssociation },
  },
}));

const { POST } = await import("./route");

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APPLICATION_ID = "com.example.reader";

const postAnswer = (
  fields: Record<string, string>,
  { provider = "apple", tenantId = TENANT_ID } = {}
) =>
  POST(
    new Request(
      `https://reader.example/api/v1/auth/${provider}/callback/android`,
      { body: new URLSearchParams(fields), method: "POST" }
    ),
    { params: Promise.resolve({ provider, tenant_id: tenantId }) }
  );

/** The query of the intent a redirect opens, read back as Android would. */
const intentQuery = (response: Response) => {
  const location = response.headers.get("Location") ?? "";
  const match =
    /^intent:\/\/callback\?(?<query>[^#]*)#Intent;(?<extras>.*);end$/u.exec(
      location
    );
  return {
    extras: match?.groups?.extras?.split(";") ?? [],
    query: Object.fromEntries(new URLSearchParams(match?.groups?.query ?? "")),
  };
};

describe("POST /api/v1/auth/apple/callback/android", () => {
  beforeEach(() => {
    mockGetAssociation.mockReset();
    mockGetAssociation.mockResolvedValue({
      android: {
        applicationId: APPLICATION_ID,
        sha256CertFingerprints: [],
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hands Apple's answer to the tenant's app as the intent sign_in_with_apple waits for", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const user = JSON.stringify({
      email: "reader@example.com",
      name: { firstName: "Ada", lastName: "Lovelace" },
    });

    const response = await postAnswer({
      code: "apple-code",
      id_token: "apple-id-token",
      state: APPLICATION_ID,
      user,
    });

    expect(response.status).toBe(303);
    const { extras, query } = intentQuery(response);
    expect(extras).toStrictEqual([
      `package=${APPLICATION_ID}`,
      "scheme=signinwithapple",
    ]);
    expect(query).toStrictEqual({
      code: "apple-code",
      id_token: "apple-id-token",
      state: APPLICATION_ID,
      user,
    });
    expect(mockGetAssociation).toHaveBeenCalledWith({
      tenant: { tenantId: TENANT_ID },
    });
  });

  it("passes on a reader stopping, so the app reports it as cancelled", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await postAnswer({
      error: "user_cancelled_authorize",
      state: APPLICATION_ID,
    });

    expect(response.status).toBe(303);
    expect(intentQuery(response).query).toStrictEqual({
      error: "user_cancelled_authorize",
      state: APPLICATION_ID,
    });
  });

  it("hands the answer to the dev flavor where the storefront runs in development", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await postAnswer({
      code: "apple-code",
      id_token: "apple-id-token",
      state: `${APPLICATION_ID}.dev`,
    });

    expect(response.status).toBe(303);
    expect(intentQuery(response).extras).toContain(
      `package=${APPLICATION_ID}.dev`
    );
  });

  it("tells the dev flavor on a production storefront that it failed, with nothing of Apple's answer", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await postAnswer({
      code: "apple-code",
      id_token: "apple-id-token",
      state: `${APPLICATION_ID}.dev`,
      user: JSON.stringify({ email: "reader@example.com" }),
    });

    expect(response.status).toBe(303);
    const { extras, query } = intentQuery(response);
    expect(extras).toContain(`package=${APPLICATION_ID}.dev`);
    expect(query).toStrictEqual({
      error: "dev_build_refused",
      state: `${APPLICATION_ID}.dev`,
    });
  });

  it("refuses an answer for an app the tenant does not name", async () => {
    const response = await postAnswer({
      code: "apple-code",
      id_token: "apple-id-token",
      state: "com.attacker.app",
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("refuses an answer that names no app", async () => {
    const response = await postAnswer({
      code: "apple-code",
      id_token: "apple-id-token",
    });

    expect(response.status).toBe(400);
    expect(mockGetAssociation).not.toHaveBeenCalled();
  });

  it("answers 404 for a tenant with no Android app", async () => {
    mockGetAssociation.mockResolvedValue({});

    const response = await postAnswer({
      code: "apple-code",
      state: APPLICATION_ID,
    });

    expect(response.status).toBe(404);
  });

  it("answers 503 when the API cannot be asked which app is the tenant's", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getTenantMobileAppAssociation */
    });
    mockGetAssociation.mockRejectedValue(
      new ConnectError("upstream", Code.Unavailable)
    );

    const response = await postAnswer({
      code: "apple-code",
      state: APPLICATION_ID,
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("answers 404 for Google, which the Android app signs in to natively", async () => {
    const response = await postAnswer(
      { code: "google-code", state: APPLICATION_ID },
      { provider: "google" }
    );

    expect(response.status).toBe(404);
    expect(mockGetAssociation).not.toHaveBeenCalled();
  });

  it("answers 404 without asking the API for a segment that is not a tenant", async () => {
    const response = await postAnswer(
      { code: "apple-code", state: APPLICATION_ID },
      { tenantId: "favicon.ico" }
    );

    expect(response.status).toBe(404);
    expect(mockGetAssociation).not.toHaveBeenCalled();
  });
});
