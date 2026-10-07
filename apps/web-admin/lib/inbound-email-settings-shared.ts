/** One credential an inbound email provider declares, as the server registers it. */
export interface InboundEmailCredentialField {
  name: string;
  /** Stored encrypted and answered back only as a masked hint. */
  secret: boolean;
  required: boolean;
}

export interface InboundEmailProvider {
  id: string;
  displayName: string;
  fields: InboundEmailCredentialField[];
  /** The storefront path the provider posts received mail to. */
  webhookPath: string;
}

export interface InboundEmailCredentialFieldState {
  name: string;
  configured: boolean;
  /** The masked value of a secret field and the value itself of any other. */
  hint: string;
}

export interface TenantInboundEmailSettings {
  /** Empty until the tenant saves a provider. */
  provider: string;
  enabled: boolean;
  /** The domain the tenant routes to the provider, empty until one is saved. */
  domain: string;
  /** One entry per field the stored provider declares. */
  fields: InboundEmailCredentialFieldState[];
  /**
   * Enabled, with a domain and every required field stored. Only then does an
   * answer's `Reply-To` name the message's own address on the domain.
   */
  ready: boolean;
}

export const emptyTenantInboundEmailSettings: TenantInboundEmailSettings = {
  domain: "",
  enabled: false,
  fields: [],
  provider: "",
  ready: false,
};

export type InboundEmailSettingsStatus =
  | "disabled"
  | "incomplete"
  | "ready"
  | "unset";

export const inboundEmailSettingsStatus = (
  settings: TenantInboundEmailSettings
): InboundEmailSettingsStatus => {
  if (settings.ready) {
    return "ready";
  }
  if (settings.enabled) {
    return "incomplete";
  }
  if (
    settings.domain !== "" ||
    settings.fields.some((field) => field.configured)
  ) {
    return "disabled";
  }
  return "unset";
};

/**
 * The addresses on `domain` a reader's reply arrives at, one per contact
 * message: `contact+<message public id>@<domain>`. The local part is
 * `replyLocalPart` in `server/internal/inboundemail`, which names the address
 * in each answer's `Reply-To` and reads the message back out of it; a provider
 * routing the whole domain covers it, and one routing single addresses has to
 * be given this pattern.
 */
export const inboundReplyAddressPattern = (domain: string): string =>
  `contact+*@${domain}`;

/**
 * What stands in the SendGrid webhook URL for the token the tenant stores,
 * which the console never shows back.
 */
export const SENDGRID_WEBHOOK_TOKEN_PLACEHOLDER = "<token>";

/**
 * The URL to register with the provider, on the storefront `origin`. Inbound
 * Parse signs nothing, so SendGrid's carries the webhook token as the password
 * of its basic auth, which SendGrid sends back on every request.
 */
export const inboundEmailWebhookUrl = (
  origin: string,
  provider: Pick<InboundEmailProvider, "id" | "webhookPath">
): string => {
  if (provider.id === "sendgrid") {
    const url = new URL(provider.webhookPath, origin);
    return `${url.protocol}//inbound:${SENDGRID_WEBHOOK_TOKEN_PLACEHOLDER}@${url.host}${url.pathname}`;
  }
  return `${origin}${provider.webhookPath}`;
};
