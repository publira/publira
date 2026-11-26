import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBuildClientAddressHeaders,
  mockProcessAppStoreNotification,
  mockProcessGooglePlayNotification,
  mockProcessPaymentWebhook,
} = vi.hoisted(() => ({
  mockBuildClientAddressHeaders: vi.fn(),
  mockProcessAppStoreNotification: vi.fn(),
  mockProcessGooglePlayNotification: vi.fn(),
  mockProcessPaymentWebhook: vi.fn(),
}));

const CLIENT_ADDRESS = { headers: { "X-Forwarded-For": "203.0.113.7" } };

vi.mock("#lib/api-client", () => ({
  buildClientAddressHeaders: mockBuildClientAddressHeaders,
  apiClient: {
    purchase: {
      processAppStoreNotification: mockProcessAppStoreNotification,
      processGooglePlayNotification: mockProcessGooglePlayNotification,
      processPaymentWebhook: mockProcessPaymentWebhook,
    },
  },
}));

const {
  forwardAppStoreNotification,
  forwardGooglePlayNotification,
  forwardPaymentWebhook,
} = await import("./payment-webhook");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const notification = () =>
  new Request("https://shop.example.test/api/v1/webhook/payment/stripe", {
    body: '{"id":"evt_001"}',
    headers: {
      "content-type": "application/json",
      "stripe-signature": "t=1,v1=abc",
    },
    method: "POST",
  });

describe("forwardPaymentWebhook", () => {
  beforeEach(() => {
    mockProcessPaymentWebhook.mockReset();
    mockProcessPaymentWebhook.mockResolvedValue({});
    mockBuildClientAddressHeaders.mockReset();
    mockBuildClientAddressHeaders.mockResolvedValue(CLIENT_ADDRESS);
  });

  it("forwards the raw body and every header with the provider id, from the sender's address", async () => {
    const response = await forwardPaymentWebhook(notification(), {
      provider: "stripe",
      tenantId: TENANT_ID,
    });

    expect(response.status).toBe(200);
    expect(mockProcessPaymentWebhook).toHaveBeenCalledWith(
      {
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=1,v1=abc",
        },
        payload: new TextEncoder().encode('{"id":"evt_001"}'),
        provider: "stripe",
        tenant: { tenantId: TENANT_ID },
      },
      CLIENT_ADDRESS
    );
  });

  it("forwards a provider id the BFF does not know by name", async () => {
    const response = await forwardPaymentWebhook(notification(), {
      provider: "pay_jp",
      tenantId: TENANT_ID,
    });

    expect(response.status).toBe(200);
    expect(mockProcessPaymentWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "pay_jp" }),
      CLIENT_ADDRESS
    );
  });

  it.each(["Stripe", "1pay", "pay-jp", "a".repeat(33)])(
    "answers 404 without calling the API server for the id %s",
    async (provider) => {
      const response = await forwardPaymentWebhook(notification(), {
        provider,
        tenantId: TENANT_ID,
      });

      expect(response.status).toBe(404);
      expect(mockProcessPaymentWebhook).not.toHaveBeenCalled();
    }
  );

  it("answers 400 for a malformed tenant path", async () => {
    const response = await forwardPaymentWebhook(notification(), {
      provider: "stripe",
      tenantId: "not-a-tenant",
    });

    expect(response.status).toBe(400);
    expect(mockProcessPaymentWebhook).not.toHaveBeenCalled();
  });

  it.each([
    [Code.NotFound, 404],
    [Code.InvalidArgument, 400],
    [Code.FailedPrecondition, 503],
    [Code.Unavailable, 503],
    [Code.PermissionDenied, 500],
  ])("maps the RPC code %s to %i", async (code, status) => {
    mockProcessPaymentWebhook.mockRejectedValue(new ConnectError("", code));

    const response = await forwardPaymentWebhook(notification(), {
      provider: "stripe",
      tenantId: TENANT_ID,
    });

    expect(response.status).toBe(status);
  });

  it("answers 429 with the wait the API server named for a sender past its allowance", async () => {
    mockProcessPaymentWebhook.mockRejectedValue(
      new ConnectError(
        "",
        Code.ResourceExhausted,
        new Headers({ "Retry-After": "42" })
      )
    );

    const response = await forwardPaymentWebhook(notification(), {
      provider: "paypay",
      tenantId: TENANT_ID,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("rethrows a failure the API server did not classify", async () => {
    const error = new ConnectError("", Code.Internal);
    mockProcessPaymentWebhook.mockRejectedValue(error);

    await expect(
      forwardPaymentWebhook(notification(), {
        provider: "stripe",
        tenantId: TENANT_ID,
      })
    ).rejects.toBe(error);
  });
});

const appStoreNotification = () =>
  new Request("https://shop.example.test/api/v1/webhook/payment/app-store", {
    body: '{"signedPayload":"eyJhbGciOiJFUzI1NiJ9.e30.sig"}',
    headers: { "content-type": "application/json" },
    method: "POST",
  });

describe("forwardAppStoreNotification", () => {
  beforeEach(() => {
    mockProcessAppStoreNotification.mockReset();
    mockProcessAppStoreNotification.mockResolvedValue({});
    mockProcessPaymentWebhook.mockReset();
  });

  it("forwards the raw body to the App Store notification RPC", async () => {
    const response = await forwardAppStoreNotification(appStoreNotification(), {
      tenantId: TENANT_ID,
    });

    expect(response.status).toBe(200);
    expect(mockProcessAppStoreNotification).toHaveBeenCalledWith({
      payload: new TextEncoder().encode(
        '{"signedPayload":"eyJhbGciOiJFUzI1NiJ9.e30.sig"}'
      ),
      tenant: { tenantId: TENANT_ID },
    });
    expect(mockProcessPaymentWebhook).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed tenant path", async () => {
    const response = await forwardAppStoreNotification(appStoreNotification(), {
      tenantId: "not-a-tenant",
    });

    expect(response.status).toBe(400);
    expect(mockProcessAppStoreNotification).not.toHaveBeenCalled();
  });

  it.each([
    [Code.InvalidArgument, 400],
    [Code.FailedPrecondition, 503],
    [Code.Unavailable, 503],
  ])("maps the RPC code %s to %i", async (code, status) => {
    mockProcessAppStoreNotification.mockRejectedValue(
      new ConnectError("", code)
    );

    const response = await forwardAppStoreNotification(appStoreNotification(), {
      tenantId: TENANT_ID,
    });

    expect(response.status).toBe(status);
  });
});

const PUSH_BODY =
  '{"message":{"data":"eyJwYWNrYWdlTmFtZSI6ImNvbS5leGFtcGxlLnJlYWRlciJ9","messageId":"1"},"subscription":"projects/p/subscriptions/s"}';

const googlePlayNotification = () =>
  new Request("https://shop.example.test/api/v1/webhook/payment/google-play", {
    body: PUSH_BODY,
    headers: {
      authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig",
      "content-type": "application/json",
    },
    method: "POST",
  });

describe("forwardGooglePlayNotification", () => {
  beforeEach(() => {
    mockProcessGooglePlayNotification.mockReset();
    mockProcessGooglePlayNotification.mockResolvedValue({});
    mockProcessPaymentWebhook.mockReset();
  });

  it("forwards the raw body and the push token to the Google Play notification RPC", async () => {
    const response = await forwardGooglePlayNotification(
      googlePlayNotification(),
      { tenantId: TENANT_ID }
    );

    expect(response.status).toBe(200);
    expect(mockProcessGooglePlayNotification).toHaveBeenCalledWith({
      headers: expect.objectContaining({
        authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig",
      }),
      payload: new TextEncoder().encode(PUSH_BODY),
      tenant: { tenantId: TENANT_ID },
    });
    expect(mockProcessPaymentWebhook).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed tenant path", async () => {
    const response = await forwardGooglePlayNotification(
      googlePlayNotification(),
      { tenantId: "not-a-tenant" }
    );

    expect(response.status).toBe(400);
    expect(mockProcessGooglePlayNotification).not.toHaveBeenCalled();
  });

  it.each([
    [Code.InvalidArgument, 400],
    [Code.FailedPrecondition, 503],
    [Code.Unavailable, 503],
  ])("maps the RPC code %s to %i", async (code, status) => {
    mockProcessGooglePlayNotification.mockRejectedValue(
      new ConnectError("", code)
    );

    const response = await forwardGooglePlayNotification(
      googlePlayNotification(),
      { tenantId: TENANT_ID }
    );

    expect(response.status).toBe(status);
  });
});
