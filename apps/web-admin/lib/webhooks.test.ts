import {
  WebhookDeliveryStatus,
  WebhookEventType,
} from "@publira/api-client/admin/webhook";
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
  mockCreateApi,
  mockGetAccessToken,
  mockListDeliveriesApi,
  mockListEndpointsApi,
  mockResendApi,
  mockUpdateApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreateApi: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListDeliveriesApi: vi.fn(),
  mockListEndpointsApi: vi.fn(),
  mockResendApi: vi.fn(),
  mockUpdateApi: vi.fn(),
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
    webhooks: {
      createWebhookEndpoint: mockCreateApi,
      listWebhookDeliveries: mockListDeliveriesApi,
      listWebhookEndpoints: mockListEndpointsApi,
      resendWebhookDelivery: mockResendApi,
      updateWebhookEndpoint: mockUpdateApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const SESSION_HEADERS = { headers: { Authorization: "Bearer session-token" } };
const ENDPOINT_ID = "018f2000-0001-7000-8000-000000000001";

const storedEndpoint = {
  createdAt: "2026-11-01T00:00:00Z",
  enabled: true,
  eventTypes: [
    WebhookEventType.PURCHASE_COMPLETED,
    WebhookEventType.SUBSCRIPTION_ENDED,
    WebhookEventType.EPISODE_PUBLISHED,
  ],
  id: ENDPOINT_ID,
  secretHint: "whsec_••••••••abcd",
  updatedAt: "2026-11-02T00:00:00Z",
  url: "https://hooks.example.com/publira",
};

const storedDelivery = {
  attempts: 3,
  createdAt: "2026-11-03T00:00:00Z",
  deliveredAt: "",
  endpointId: ENDPOINT_ID,
  endpointUrl: "https://hooks.example.com/publira",
  eventId: "evt_1",
  eventType: WebhookEventType.TEST,
  id: "018f2000-0002-7000-8000-000000000001",
  lastError: "the endpoint answered HTTP 500",
  lastStatusCode: 500,
  status: WebhookDeliveryStatus.DEAD,
  updatedAt: "2026-11-03T00:10:00Z",
};

const endpointInput = {
  enabled: true,
  eventTypes: ["purchase.completed", "reader.signed_up"] as const,
  tenantId: "TENANT001",
  url: "https://hooks.example.com/publira",
};

describe("webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("lists the endpoints under the tenant's tag", async () => {
    mockListEndpointsApi.mockResolvedValueOnce({
      endpoints: [storedEndpoint],
    });
    const { listWebhookEndpoints } = await import("./webhooks");

    const result = await listWebhookEndpoints("TENANT001", "en");

    expect(result).toEqual({
      endpoints: [
        {
          createdAt: "2026-11-01T00:00:00Z",
          enabled: true,
          eventTypes: [
            "purchase.completed",
            "subscription.ended",
            "episode.published",
          ],
          id: ENDPOINT_ID,
          secretHint: "whsec_••••••••abcd",
          updatedAt: "2026-11-02T00:00:00Z",
          url: "https://hooks.example.com/publira",
        },
      ],
      ok: true,
    });
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:webhook-endpoints"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("asks for the deliveries in the status the filter names", async () => {
    mockListDeliveriesApi.mockResolvedValueOnce({
      deliveries: [storedDelivery],
      nextToken: "next",
      previousToken: "",
    });
    const { listWebhookDeliveries } = await import("./webhooks");

    const result = await listWebhookDeliveries("TENANT001", "en", {
      status: "dead",
      token: "page-2",
    });

    expect(mockListDeliveriesApi).toHaveBeenCalledWith(
      {
        limit: 20,
        status: WebhookDeliveryStatus.DEAD,
        tenant: { tenantId: "TENANT001" },
        token: "page-2",
      },
      SESSION_HEADERS
    );
    expect(result).toEqual({
      deliveries: [
        {
          attempts: 3,
          createdAt: "2026-11-03T00:00:00Z",
          deliveredAt: "",
          endpointId: ENDPOINT_ID,
          endpointUrl: "https://hooks.example.com/publira",
          eventType: "webhook.test",
          id: "018f2000-0002-7000-8000-000000000001",
          lastError: "the endpoint answered HTTP 500",
          lastStatusCode: 500,
          status: "dead",
          updatedAt: "2026-11-03T00:10:00Z",
        },
      ],
      nextToken: "next",
      ok: true,
      previousToken: "",
    });
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:webhook-deliveries"
    );
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });

  it("asks for every delivery when no status is named", async () => {
    mockListDeliveriesApi.mockResolvedValueOnce({ deliveries: [] });
    const { listWebhookDeliveries } = await import("./webhooks");

    await listWebhookDeliveries("TENANT001", "en");

    expect(mockListDeliveriesApi).toHaveBeenCalledWith(
      expect.objectContaining({ status: WebhookDeliveryStatus.UNSPECIFIED }),
      SESSION_HEADERS
    );
  });

  it("creates an endpoint and answers its secret once", async () => {
    mockCreateApi.mockResolvedValueOnce({
      endpoint: storedEndpoint,
      secret: "whsec_secret",
    });
    const { createWebhookEndpoint } = await import("./webhooks");

    const result = await createWebhookEndpoint(endpointInput, "en");

    expect(result).toMatchObject({ ok: true, secret: "whsec_secret" });
    expect(mockCreateApi).toHaveBeenCalledWith(
      {
        enabled: true,
        eventTypes: [
          WebhookEventType.PURCHASE_COMPLETED,
          WebhookEventType.READER_SIGNED_UP,
        ],
        tenant: { tenantId: "TENANT001" },
        url: "https://hooks.example.com/publira",
      },
      SESSION_HEADERS
    );
  });

  it("says a sixth endpoint is past the limit", async () => {
    mockCreateApi.mockRejectedValueOnce(
      new ConnectError("limit", Code.FailedPrecondition, undefined, [
        {
          desc: ErrorInfoSchema,
          value: { domain: "publira", reason: "WEBHOOK_ENDPOINT_LIMIT" },
        },
      ])
    );
    const { createWebhookEndpoint } = await import("./webhooks");

    const result = await createWebhookEndpoint(endpointInput, "en");

    expect(result).toEqual({
      message:
        "This tenant keeps 5 endpoints, the most it may. Delete one to add another.",
      ok: false,
    });
  });

  it("says why a secret cannot be stored when no key seals it", async () => {
    mockCreateApi.mockRejectedValueOnce(
      new ConnectError("no key", Code.FailedPrecondition)
    );
    const { createWebhookEndpoint } = await import("./webhooks");

    const result = await createWebhookEndpoint(endpointInput, "en");

    expect(result).toMatchObject({
      message: expect.stringContaining("PUBLIRA_SECRET_ENCRYPTION_KEYS"),
      ok: false,
    });
  });

  it("words a URL the API refused", async () => {
    mockUpdateApi.mockRejectedValueOnce(
      new ConnectError("invalid", Code.InvalidArgument, undefined, [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: "url" }] },
        },
      ])
    );
    const { updateWebhookEndpoint } = await import("./webhooks");

    const result = await updateWebhookEndpoint(
      ENDPOINT_ID,
      endpointInput,
      "en"
    );

    expect(result).toEqual({
      message:
        "Enter an https URL with a host name, and without a user name, a password, or a fragment.",
      ok: false,
    });
  });

  it("says only a dead delivery can be resent", async () => {
    mockResendApi.mockRejectedValueOnce(
      new ConnectError("not dead", Code.FailedPrecondition)
    );
    const { resendWebhookDelivery } = await import("./webhooks");

    const result = await resendWebhookDelivery(
      "TENANT001",
      storedDelivery.id,
      "en"
    );

    expect(result).toEqual({
      message:
        "Only a dead delivery can be resent. Reload the page to see where it stands.",
      ok: false,
    });
  });
});
