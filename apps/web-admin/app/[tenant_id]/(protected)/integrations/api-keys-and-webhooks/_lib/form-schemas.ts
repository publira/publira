import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { API_KEY_SCOPES } from "#lib/api-keys";
import {
  checkboxOnFormSchema,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import { WEBHOOK_EVENT_TYPES } from "#lib/webhooks";

/** Mirrors the server's bound on a key's name. */
export const MAX_API_KEY_NAME_LENGTH = 100;

/** Mirrors `tenantwebhooks.ValidateURL`. */
export const MAX_WEBHOOK_URL_LENGTH = 2048;

export const apiKeyCreateFormFields = {
  name: { kind: "value", name: "name" },
  scopes: { kind: "values", name: "scopes" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

export const apiKeyRevokeFormFields = {
  apiKeyId: { kind: "value", name: "api_key_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

export const webhookEndpointFormFields = {
  enabled: { kind: "value", name: "enabled" },
  eventTypes: { kind: "values", name: "event_types" },
  tenantId: { kind: "value", name: "tenant_id" },
  url: { kind: "value", name: "url" },
} as const;

export const webhookEndpointIdFormFields = {
  endpointId: { kind: "value", name: "endpoint_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

export const webhookDeliveryIdFormFields = {
  deliveryId: { kind: "value", name: "delivery_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

/**
 * Whether `value` is the URL the server takes: https, with a host, and with
 * neither a user name, a password, nor a fragment. Where the host resolves is
 * the worker's check, made as each delivery is sent.
 */
export const isWebhookUrl = (value: string): boolean => {
  if (!URL.canParse(value)) {
    return false;
  }

  const url = new URL(value);

  return (
    url.protocol === "https:" &&
    url.hostname !== "" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === ""
  );
};

export const apiKeyCreateFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    name: requiredTrimmedString(
      t("admin.settings.api_keys.validation.name_required"),
      MAX_API_KEY_NAME_LENGTH,
      t("admin.settings.api_keys.validation.name_length")
    ),
    scopes: z
      .array(z.enum(API_KEY_SCOPES))
      .min(1, t("admin.settings.api_keys.validation.scopes_required"))
      .transform((scopes) => [...new Set(scopes)]),
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
  });
};

export const apiKeyRevokeFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    apiKeyId: requiredRecordId(t("admin.settings.api_keys.id_missing")),
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
  });
};

export const webhookEndpointFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const urlMessage = t("admin.settings.webhooks.validation.url_https");

  return z.object({
    enabled: checkboxOnFormSchema,
    eventTypes: z
      .array(z.enum(WEBHOOK_EVENT_TYPES))
      .min(1, t("admin.settings.webhooks.validation.events_required"))
      .transform((eventTypes) => [...new Set(eventTypes)]),
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    url: requiredTrimmedString(
      t("admin.settings.webhooks.validation.url_required"),
      MAX_WEBHOOK_URL_LENGTH,
      t("admin.settings.webhooks.validation.url_length")
    ).refine(isWebhookUrl, urlMessage),
  });
};

export const webhookEndpointIdFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    endpointId: requiredRecordId(t("admin.settings.webhooks.id_missing")),
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
  });
};

export const webhookDeliveryIdFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    deliveryId: requiredRecordId(
      t("admin.settings.webhooks.deliveries.id_missing")
    ),
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
  });
};
