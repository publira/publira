import { Code, ConnectError } from "@publira/api-client/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockProcessInboundEmailWebhook } = vi.hoisted(() => ({
  mockProcessInboundEmailWebhook: vi.fn(),
}));

vi.mock("#lib/api-client", () => ({
  apiClient: {
    contact: {
      processInboundEmailWebhook: mockProcessInboundEmailWebhook,
    },
  },
}));

const { forwardInboundEmailWebhook, MAX_INBOUND_EMAIL_PAYLOAD_BYTES } =
  await import("./inbound-email-webhook");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const SENDGRID_BOUNDARY = "xYzZY";

/** A SendGrid Inbound Parse post, as recorded with basic auth in the URL. */
const sendGridPost = () => {
  const body = [
    `--${SENDGRID_BOUNDARY}`,
    'Content-Disposition: form-data; name="from"',
    "",
    "Alex Reader <alex.reader@example.net>",
    `--${SENDGRID_BOUNDARY}`,
    'Content-Disposition: form-data; name="to"',
    "",
    "Example Comics <contact+7Hn3QzW9kPfa@reply.example.com>",
    `--${SENDGRID_BOUNDARY}`,
    'Content-Disposition: form-data; name="text"',
    "",
    "Thanks, the episode opens now.",
    `--${SENDGRID_BOUNDARY}--`,
    "",
  ].join("\r\n");
  return {
    body,
    headers: {
      authorization: "Basic aW5ib3VuZDpzZ190b2tlbg==",
      "content-type": `multipart/form-data; boundary=${SENDGRID_BOUNDARY}`,
    },
  };
};

/** A Resend `email.received` event, as Svix signs and delivers it. */
const resendPost = () => ({
  body: JSON.stringify({
    created_at: "2026-10-05T10:12:31.482Z",
    data: {
      email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
      from: "alex.reader@example.net",
      message_id: "<CAJ4k2m1+9xQ@mail.example.net>",
      subject: "Re: About my purchase",
      to: ["contact+7Hn3QzW9kPfa@reply.example.com"],
    },
    type: "email.received",
  }),
  headers: {
    "content-type": "application/json",
    "svix-id": "msg_2mN8xQe5Rk3vTqLw",
    "svix-signature": "v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=",
    "svix-timestamp": "1791195151",
  },
});

const post = (
  provider: string,
  { body, headers }: { body: BodyInit; headers: Record<string, string> }
) =>
  new Request(`https://shop.example.test/api/v1/webhook/email/${provider}`, {
    body,
    headers,
    method: "POST",
  });

describe("forwardInboundEmailWebhook", () => {
  beforeEach(() => {
    mockProcessInboundEmailWebhook.mockReset();
    mockProcessInboundEmailWebhook.mockResolvedValue({});
  });

  it("forwards a SendGrid post with its body, content type, and basic auth intact", async () => {
    const { body, headers } = sendGridPost();

    const response = await forwardInboundEmailWebhook(
      post("sendgrid", { body, headers }),
      { provider: "sendgrid", tenantId: TENANT_ID }
    );

    expect(response.status).toBe(204);
    expect(mockProcessInboundEmailWebhook).toHaveBeenCalledWith({
      headers,
      payload: new TextEncoder().encode(body),
      provider: "sendgrid",
      tenant: { tenantId: TENANT_ID },
    });
  });

  it("forwards a Resend post with its body and Svix signature headers intact", async () => {
    const { body, headers } = resendPost();

    const response = await forwardInboundEmailWebhook(
      post("resend", { body, headers }),
      { provider: "resend", tenantId: TENANT_ID }
    );

    expect(response.status).toBe(204);
    expect(mockProcessInboundEmailWebhook).toHaveBeenCalledWith({
      headers,
      payload: new TextEncoder().encode(body),
      provider: "resend",
      tenant: { tenantId: TENANT_ID },
    });
  });

  it.each(["SendGrid", "1mail", "send-grid", "a".repeat(33)])(
    "answers 404 without calling the API server for the id %s",
    async (provider) => {
      const response = await forwardInboundEmailWebhook(
        post(provider, resendPost()),
        { provider, tenantId: TENANT_ID }
      );

      expect(response.status).toBe(404);
      expect(mockProcessInboundEmailWebhook).not.toHaveBeenCalled();
    }
  );

  it("answers 400 for a malformed tenant path", async () => {
    const response = await forwardInboundEmailWebhook(
      post("resend", resendPost()),
      { provider: "resend", tenantId: "not-a-tenant" }
    );

    expect(response.status).toBe(400);
    expect(mockProcessInboundEmailWebhook).not.toHaveBeenCalled();
  });

  it.each([
    [Code.NotFound, 404],
    [Code.InvalidArgument, 400],
    [Code.Unauthenticated, 401],
    [Code.FailedPrecondition, 503],
    [Code.Unavailable, 503],
    [Code.PermissionDenied, 500],
  ])("maps the RPC code %s to %i", async (code, status) => {
    mockProcessInboundEmailWebhook.mockRejectedValue(
      new ConnectError("", code)
    );

    const response = await forwardInboundEmailWebhook(
      post("resend", resendPost()),
      { provider: "resend", tenantId: TENANT_ID }
    );

    expect(response.status).toBe(status);
  });

  it("rethrows a failure the API server did not classify", async () => {
    const error = new ConnectError("", Code.Internal);
    mockProcessInboundEmailWebhook.mockRejectedValue(error);

    await expect(
      forwardInboundEmailWebhook(post("resend", resendPost()), {
        provider: "resend",
        tenantId: TENANT_ID,
      })
    ).rejects.toBe(error);
  });

  describe("a body at the payload limit", () => {
    const CHUNK_BYTES = 1024 * 1024;

    /**
     * A post whose body is streamed in 1 MiB chunks up to `totalBytes`,
     * counting how much of it was read.
     */
    const streamedPost = (totalBytes: number) => {
      const read = { bytes: 0 };
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          const size = Math.min(CHUNK_BYTES, totalBytes - read.bytes);
          if (size <= 0) {
            controller.close();
            return;
          }
          read.bytes += size;
          controller.enqueue(new Uint8Array(size));
        },
      });
      const request = new Request(
        "https://shop.example.test/api/v1/webhook/email/sendgrid",
        {
          body,
          duplex: "half",
          headers: sendGridPost().headers,
          method: "POST",
        } as RequestInit
      );
      return { read, request };
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("forwards a body of exactly the limit", async () => {
      const { request } = streamedPost(MAX_INBOUND_EMAIL_PAYLOAD_BYTES);

      const response = await forwardInboundEmailWebhook(request, {
        provider: "sendgrid",
        tenantId: TENANT_ID,
      });

      expect(response.status).toBe(204);
      expect(
        mockProcessInboundEmailWebhook.mock.calls[0]?.[0].payload.byteLength
      ).toBe(MAX_INBOUND_EMAIL_PAYLOAD_BYTES);
    });

    it("acknowledges a larger body without forwarding it or reading it to the end", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { read, request } = streamedPost(
        MAX_INBOUND_EMAIL_PAYLOAD_BYTES * 2
      );

      const response = await forwardInboundEmailWebhook(request, {
        provider: "sendgrid",
        tenantId: TENANT_ID,
      });

      expect(response.status).toBe(204);
      expect(mockProcessInboundEmailWebhook).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledOnce();
      expect(read.bytes).toBeLessThan(MAX_INBOUND_EMAIL_PAYLOAD_BYTES * 2);
    });
  });
});
