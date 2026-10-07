import { describe, expect, it } from "vitest";

import {
  emptyTenantInboundEmailSettings,
  inboundEmailSettingsStatus,
  inboundEmailWebhookUrl,
  inboundReplyAddressPattern,
} from "./inbound-email-settings-shared";
import type { TenantInboundEmailSettings } from "./inbound-email-settings-shared";

const settings = (
  overrides: Partial<TenantInboundEmailSettings>
): TenantInboundEmailSettings => ({
  ...emptyTenantInboundEmailSettings,
  provider: "sendgrid",
  ...overrides,
});

describe("inboundEmailSettingsStatus", () => {
  it("is unset while nothing is stored", () => {
    expect(inboundEmailSettingsStatus(emptyTenantInboundEmailSettings)).toBe(
      "unset"
    );
  });

  it("is disabled once a domain or a credential is stored with it off", () => {
    expect(
      inboundEmailSettingsStatus(settings({ domain: "reply.example.com" }))
    ).toBe("disabled");
    expect(
      inboundEmailSettingsStatus(
        settings({
          fields: [
            { configured: true, hint: "tok••••WXYZ", name: "webhook_token" },
          ],
        })
      )
    ).toBe("disabled");
  });

  it("is incomplete while on but not ready, and ready once the server says so", () => {
    expect(inboundEmailSettingsStatus(settings({ enabled: true }))).toBe(
      "incomplete"
    );
    expect(
      inboundEmailSettingsStatus(settings({ enabled: true, ready: true }))
    ).toBe("ready");
  });
});

describe("inboundReplyAddressPattern", () => {
  it("names the per-message addresses on the domain", () => {
    expect(inboundReplyAddressPattern("reply.example.com")).toBe(
      "contact+*@reply.example.com"
    );
  });
});

describe("inboundEmailWebhookUrl", () => {
  it("puts SendGrid's token in the URL as the basic auth password", () => {
    expect(
      inboundEmailWebhookUrl("https://comics.example", {
        id: "sendgrid",
        webhookPath: "/api/v1/webhook/email/sendgrid",
      })
    ).toBe(
      "https://inbound:<token>@comics.example/api/v1/webhook/email/sendgrid"
    );
  });

  it("keeps the port of a storefront that has one", () => {
    expect(
      inboundEmailWebhookUrl("http://comics.localhost:3080", {
        id: "sendgrid",
        webhookPath: "/api/v1/webhook/email/sendgrid",
      })
    ).toBe(
      "http://inbound:<token>@comics.localhost:3080/api/v1/webhook/email/sendgrid"
    );
  });

  it("appends the path to the origin for every other provider", () => {
    expect(
      inboundEmailWebhookUrl("https://comics.example", {
        id: "resend",
        webhookPath: "/api/v1/webhook/email/resend",
      })
    ).toBe("https://comics.example/api/v1/webhook/email/resend");
  });
});
