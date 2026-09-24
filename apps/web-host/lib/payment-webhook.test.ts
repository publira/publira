import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockProcessPaymentWebhook } = vi.hoisted(() => ({
  mockProcessPaymentWebhook: vi.fn(),
}));

vi.mock("#lib/api-client", () => ({
  apiClient: { purchase: { processPaymentWebhook: mockProcessPaymentWebhook } },
}));

const { forwardPaymentWebhook } = await import("./payment-webhook");

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
  });

  it("forwards the raw body and every header with the provider id", async () => {
    const response = await forwardPaymentWebhook(notification(), {
      provider: "stripe",
      tenantId: TENANT_ID,
    });

    expect(response.status).toBe(204);
    expect(mockProcessPaymentWebhook).toHaveBeenCalledWith({
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=1,v1=abc",
      },
      payload: new TextEncoder().encode('{"id":"evt_001"}'),
      provider: "stripe",
      tenant: { tenantId: TENANT_ID },
    });
  });

  it("forwards a provider id the BFF does not know by name", async () => {
    const response = await forwardPaymentWebhook(notification(), {
      provider: "pay_jp",
      tenantId: TENANT_ID,
    });

    expect(response.status).toBe(204);
    expect(mockProcessPaymentWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "pay_jp" })
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
