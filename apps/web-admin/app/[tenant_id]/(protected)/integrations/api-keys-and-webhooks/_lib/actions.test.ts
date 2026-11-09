import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreateApiKey,
  mockCreateWebhookEndpoint,
  mockDeleteWebhookEndpoint,
  mockGetAccessToken,
  mockResendWebhookDelivery,
  mockRevokeApiKey,
  mockRotateWebhookSecret,
  mockSendTestWebhook,
  mockUpdateTag,
  mockUpdateWebhookEndpoint,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateApiKey: vi.fn(),
  mockCreateWebhookEndpoint: vi.fn(),
  mockDeleteWebhookEndpoint: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockResendWebhookDelivery: vi.fn(),
  mockRevokeApiKey: vi.fn(),
  mockRotateWebhookSecret: vi.fn(),
  mockSendTestWebhook: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateWebhookEndpoint: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/api-keys", () => ({
  API_KEY_SCOPES: ["catalog", "purchases", "catalog_write"],
  apiKeysCacheTag: (tenantId: string) => `tenant:${tenantId}:api-keys`,
  createApiKey: mockCreateApiKey,
  revokeApiKey: mockRevokeApiKey,
}));

vi.mock("#lib/webhooks", () => ({
  WEBHOOK_EVENT_TYPES: [
    "purchase.completed",
    "purchase.refunded",
    "reader.signed_up",
    "subscription.started",
    "subscription.ended",
  ],
  createWebhookEndpoint: mockCreateWebhookEndpoint,
  deleteWebhookEndpoint: mockDeleteWebhookEndpoint,
  resendWebhookDelivery: mockResendWebhookDelivery,
  rotateWebhookSecret: mockRotateWebhookSecret,
  sendTestWebhook: mockSendTestWebhook,
  updateWebhookEndpoint: mockUpdateWebhookEndpoint,
  webhookDeliveriesCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:webhook-deliveries`,
  webhookEndpointsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:webhook-endpoints`,
}));

const TENANT_ID = "TENANT001";
const ENDPOINT_ID = "018f2000-0001-7000-8000-000000000001";
const DELIVERY_ID = "018f2000-0002-7000-8000-000000000001";
const API_KEY_ID = "018f2000-0003-7000-8000-000000000001";

/** The fields a form posts, a field posted more than once listed once per value. */
const formDataOf = (fields: Record<string, readonly string[]>): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", TENANT_ID);

  for (const [name, values] of Object.entries(fields)) {
    for (const value of values) {
      formData.append(name, value);
    }
  }

  return formData;
};

const endpointFormData = (
  url: string,
  eventTypes: readonly string[] = ["purchase.completed", "reader.signed_up"]
): FormData =>
  formDataOf({ enabled: ["on"], event_types: eventTypes, url: [url] });

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("createApiKeyAction", () => {
  it("answers the key once and clears the key list", async () => {
    mockCreateApiKey.mockResolvedValueOnce({
      apiKey: { id: API_KEY_ID },
      key: "pbk_abcdefghijkl_secret",
      ok: true,
    });
    const { createApiKeyAction } = await import("./actions");

    const result = await createApiKeyAction(
      null,
      formDataOf({ name: [" CRM "], scopes: ["purchases", "catalog"] })
    );

    expect(result).toEqual({
      message: "The API key was created.",
      ok: true,
      secret: "pbk_abcdefghijkl_secret",
    });
    expect(mockCreateApiKey).toHaveBeenCalledWith(
      { name: "CRM", scopes: ["purchases", "catalog"], tenantId: TENANT_ID },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:api-keys");
  });

  it("refuses a key with no scope before asking the API", async () => {
    const { createApiKeyAction } = await import("./actions");

    const result = await createApiKeyAction(
      null,
      formDataOf({ name: ["CRM"] })
    );

    expect(result).toEqual({
      message: "Choose at least one scope.",
      ok: false,
    });
    expect(mockCreateApiKey).not.toHaveBeenCalled();
  });

  it("passes the API's refusal on without a key", async () => {
    mockCreateApiKey.mockResolvedValueOnce({
      message: "The name must be 1 to 100 characters.",
      ok: false,
    });
    const { createApiKeyAction } = await import("./actions");

    const result = await createApiKeyAction(
      null,
      formDataOf({ name: ["CRM"], scopes: ["catalog"] })
    );

    expect(result).toEqual({
      message: "The name must be 1 to 100 characters.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("revokeApiKeyAction", () => {
  it("revokes the key the form names", async () => {
    mockRevokeApiKey.mockResolvedValueOnce({ apiKey: {}, ok: true });
    const { revokeApiKeyAction } = await import("./actions");

    const result = await revokeApiKeyAction(
      null,
      formDataOf({ api_key_id: [API_KEY_ID] })
    );

    expect(result).toEqual({ message: "The API key was revoked.", ok: true });
    expect(mockRevokeApiKey).toHaveBeenCalledWith(TENANT_ID, API_KEY_ID, "en");
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:api-keys");
  });

  it("refuses a key ID that is not a UUID", async () => {
    const { revokeApiKeyAction } = await import("./actions");

    const result = await revokeApiKeyAction(
      null,
      formDataOf({ api_key_id: ["not-a-uuid"] })
    );

    expect(result?.ok).toBe(false);
    expect(mockRevokeApiKey).not.toHaveBeenCalled();
  });
});

describe("createWebhookEndpointAction", () => {
  it("answers the signing secret once and clears the endpoint list", async () => {
    mockCreateWebhookEndpoint.mockResolvedValueOnce({
      endpoint: { id: ENDPOINT_ID },
      ok: true,
      secret: "whsec_secret",
    });
    const { createWebhookEndpointAction } = await import("./actions");

    const result = await createWebhookEndpointAction(
      null,
      endpointFormData("https://hooks.example.com/publira")
    );

    expect(result).toEqual({
      message: "The endpoint was added.",
      ok: true,
      secret: "whsec_secret",
    });
    expect(mockCreateWebhookEndpoint).toHaveBeenCalledWith(
      {
        enabled: true,
        eventTypes: ["purchase.completed", "reader.signed_up"],
        tenantId: TENANT_ID,
        url: "https://hooks.example.com/publira",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:webhook-endpoints"
    );
  });

  it.each([
    ["an http URL", "http://hooks.example.com/publira"],
    ["a URL with a password", "https://user:pass@hooks.example.com/"],
    ["a URL with a fragment", "https://hooks.example.com/#part"],
    ["something that is not a URL", "hooks.example.com"],
  ])("refuses %s on the form", async (_label, url) => {
    const { createWebhookEndpointAction } = await import("./actions");

    const result = await createWebhookEndpointAction(
      null,
      endpointFormData(url)
    );

    expect(result).toEqual({
      message:
        "Enter an https URL with a host name, and without a user name, a password, or a fragment.",
      ok: false,
    });
    expect(mockCreateWebhookEndpoint).not.toHaveBeenCalled();
  });

  it("refuses an endpoint with no event", async () => {
    const { createWebhookEndpointAction } = await import("./actions");

    const result = await createWebhookEndpointAction(
      null,
      endpointFormData("https://hooks.example.com/", [])
    );

    expect(result).toEqual({
      message: "Choose at least one event.",
      ok: false,
    });
  });

  it("leaves a switch that was not posted off", async () => {
    mockCreateWebhookEndpoint.mockResolvedValueOnce({
      endpoint: {},
      ok: true,
      secret: "whsec_secret",
    });
    const { createWebhookEndpointAction } = await import("./actions");

    await createWebhookEndpointAction(
      null,
      formDataOf({
        event_types: ["purchase.refunded"],
        url: ["https://hooks.example.com/"],
      })
    );

    expect(mockCreateWebhookEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
      "en"
    );
  });
});

describe("updateWebhookEndpointAction", () => {
  it("saves the endpoint the form names", async () => {
    mockUpdateWebhookEndpoint.mockResolvedValueOnce({ endpoint: {}, ok: true });
    const { updateWebhookEndpointAction } = await import("./actions");

    const formData = endpointFormData("https://hooks.example.com/v2", [
      "subscription.started",
      "subscription.ended",
    ]);

    formData.set("endpoint_id", ENDPOINT_ID);

    const result = await updateWebhookEndpointAction(null, formData);

    expect(result).toEqual({ message: "The endpoint was saved.", ok: true });
    expect(mockUpdateWebhookEndpoint).toHaveBeenCalledWith(
      ENDPOINT_ID,
      {
        enabled: true,
        eventTypes: ["subscription.started", "subscription.ended"],
        tenantId: TENANT_ID,
        url: "https://hooks.example.com/v2",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:webhook-endpoints"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:webhook-deliveries"
    );
  });

  it("refuses a form that names no endpoint", async () => {
    const { updateWebhookEndpointAction } = await import("./actions");

    const result = await updateWebhookEndpointAction(
      null,
      endpointFormData("https://hooks.example.com/")
    );

    expect(result?.ok).toBe(false);
    expect(mockUpdateWebhookEndpoint).not.toHaveBeenCalled();
  });
});

describe("rotateWebhookSecretAction", () => {
  it("answers the new secret once", async () => {
    mockRotateWebhookSecret.mockResolvedValueOnce({
      endpoint: {},
      ok: true,
      secret: "whsec_new",
    });
    const { rotateWebhookSecretAction } = await import("./actions");

    const result = await rotateWebhookSecretAction(
      null,
      formDataOf({ endpoint_id: [ENDPOINT_ID] })
    );

    expect(result).toEqual({
      message: "The signing secret was rotated.",
      ok: true,
      secret: "whsec_new",
    });
    expect(mockRotateWebhookSecret).toHaveBeenCalledWith(
      TENANT_ID,
      ENDPOINT_ID,
      "en"
    );
  });
});

describe("deleteWebhookEndpointAction", () => {
  it("clears the endpoints and the deliveries deleted with them", async () => {
    mockDeleteWebhookEndpoint.mockResolvedValueOnce({ ok: true });
    const { deleteWebhookEndpointAction } = await import("./actions");

    const result = await deleteWebhookEndpointAction(
      null,
      formDataOf({ endpoint_id: [ENDPOINT_ID] })
    );

    expect(result).toEqual({ message: "The endpoint was deleted.", ok: true });
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:webhook-endpoints"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:webhook-deliveries"
    );
  });
});

describe("sendTestWebhookAction", () => {
  it("queues a test event and clears the delivery list", async () => {
    mockSendTestWebhook.mockResolvedValueOnce({ delivery: {}, ok: true });
    const { sendTestWebhookAction } = await import("./actions");

    const result = await sendTestWebhookAction(
      null,
      formDataOf({ endpoint_id: [ENDPOINT_ID] })
    );

    expect(result).toEqual({
      message: "A test event was queued. It is listed under Deliveries.",
      ok: true,
    });
    expect(mockSendTestWebhook).toHaveBeenCalledWith(
      TENANT_ID,
      ENDPOINT_ID,
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:webhook-deliveries"
    );
  });
});

describe("resendWebhookDeliveryAction", () => {
  it("queues the delivery again and clears the delivery list", async () => {
    mockResendWebhookDelivery.mockResolvedValueOnce({ delivery: {}, ok: true });
    const { resendWebhookDeliveryAction } = await import("./actions");

    const result = await resendWebhookDeliveryAction(
      null,
      formDataOf({ delivery_id: [DELIVERY_ID] })
    );

    expect(result).toEqual({
      message: "The delivery was queued again.",
      ok: true,
    });
    expect(mockResendWebhookDelivery).toHaveBeenCalledWith(
      TENANT_ID,
      DELIVERY_ID,
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:webhook-deliveries"
    );
  });

  it("passes the API's refusal on", async () => {
    mockResendWebhookDelivery.mockResolvedValueOnce({
      message: "Only a dead delivery can be resent.",
      ok: false,
    });
    const { resendWebhookDeliveryAction } = await import("./actions");

    const result = await resendWebhookDeliveryAction(
      null,
      formDataOf({ delivery_id: [DELIVERY_ID] })
    );

    expect(result).toEqual({
      message: "Only a dead delivery can be resent.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
