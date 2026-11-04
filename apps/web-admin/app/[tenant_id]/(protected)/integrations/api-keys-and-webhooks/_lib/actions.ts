"use server";

import type * as ActionForm from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";

import { getActionLocale } from "#lib/action-messages";
import { apiKeysCacheTag, createApiKey, revokeApiKey } from "#lib/api-keys";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getMessagesFor } from "#lib/messages";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  resendWebhookDelivery,
  rotateWebhookSecret,
  sendTestWebhook,
  updateWebhookEndpoint,
  webhookDeliveriesCacheTag,
  webhookEndpointsCacheTag,
} from "#lib/webhooks";

import type { IssuedSecretFormState } from "../api-keys-and-webhooks-types";
import {
  apiKeyCreateFormFields,
  apiKeyCreateFormSchema,
  apiKeyRevokeFormFields,
  apiKeyRevokeFormSchema,
  webhookDeliveryIdFormFields,
  webhookDeliveryIdFormSchema,
  webhookEndpointFormFields,
  webhookEndpointFormSchema,
  webhookEndpointIdFormFields,
  webhookEndpointIdFormSchema,
} from "./form-schemas";

export const createApiKeyAction = async (
  _prevState: IssuedSecretFormState,
  formData: FormData
): Promise<IssuedSecretFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    apiKeyCreateFormSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, apiKeyCreateFormFields)
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { name, scopes, tenantId } = parsed.data;

  const result = await withAdminSessionReauth(() =>
    createApiKey({ name, scopes, tenantId }, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(apiKeysCacheTag(tenantId));

  return {
    message: t("admin.settings.api_keys.created"),
    ok: true,
    secret: result.key,
  };
};

export const revokeApiKeyAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    apiKeyRevokeFormSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, apiKeyRevokeFormFields)
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { apiKeyId, tenantId } = parsed.data;

  const result = await withAdminSessionReauth(() =>
    revokeApiKey(tenantId, apiKeyId, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(apiKeysCacheTag(tenantId));

  return { message: t("admin.settings.api_keys.revoked"), ok: true };
};

export const createWebhookEndpointAction = async (
  _prevState: IssuedSecretFormState,
  formData: FormData
): Promise<IssuedSecretFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    webhookEndpointFormSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, webhookEndpointFormFields)
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    createWebhookEndpoint(parsed.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(webhookEndpointsCacheTag(parsed.data.tenantId));

  return {
    message: t("admin.settings.webhooks.created"),
    ok: true,
    secret: result.secret,
  };
};

export const updateWebhookEndpointAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema, idSchema] = await Promise.all([
    getMessagesFor(locale),
    webhookEndpointFormSchema(locale),
    webhookEndpointIdFormSchema(locale),
  ]);

  const parsedId = idSchema.safeParse(
    toFormDataInput(formData, webhookEndpointIdFormFields)
  );

  const parsed = schema.safeParse(
    toFormDataInput(formData, webhookEndpointFormFields)
  );

  if (!parsedId.success) {
    return {
      message: toFormErrorMessage(parsedId.error, { locale }),
      ok: false,
    };
  }

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    updateWebhookEndpoint(parsedId.data.endpointId, parsed.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // A delivery is listed with its endpoint's URL as it stands now.
  updateTag(webhookEndpointsCacheTag(parsed.data.tenantId));
  updateTag(webhookDeliveriesCacheTag(parsed.data.tenantId));

  return { message: t("admin.settings.webhooks.saved"), ok: true };
};

export const rotateWebhookSecretAction = async (
  _prevState: IssuedSecretFormState,
  formData: FormData
): Promise<IssuedSecretFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    webhookEndpointIdFormSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, webhookEndpointIdFormFields)
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { endpointId, tenantId } = parsed.data;

  const result = await withAdminSessionReauth(() =>
    rotateWebhookSecret(tenantId, endpointId, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(webhookEndpointsCacheTag(tenantId));

  return {
    message: t("admin.settings.webhooks.rotated"),
    ok: true,
    secret: result.secret,
  };
};

export const deleteWebhookEndpointAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    webhookEndpointIdFormSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, webhookEndpointIdFormFields)
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { endpointId, tenantId } = parsed.data;

  const result = await withAdminSessionReauth(() =>
    deleteWebhookEndpoint(tenantId, endpointId, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // The endpoint's deliveries are deleted with it.
  updateTag(webhookEndpointsCacheTag(tenantId));
  updateTag(webhookDeliveriesCacheTag(tenantId));

  return { message: t("admin.settings.webhooks.deleted"), ok: true };
};

export const sendTestWebhookAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    webhookEndpointIdFormSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, webhookEndpointIdFormFields)
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { endpointId, tenantId } = parsed.data;

  const result = await withAdminSessionReauth(() =>
    sendTestWebhook(tenantId, endpointId, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(webhookDeliveriesCacheTag(tenantId));

  return { message: t("admin.settings.webhooks.test_sent"), ok: true };
};

export const resendWebhookDeliveryAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    webhookDeliveryIdFormSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, webhookDeliveryIdFormFields)
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { deliveryId, tenantId } = parsed.data;

  const result = await withAdminSessionReauth(() =>
    resendWebhookDelivery(tenantId, deliveryId, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(webhookDeliveriesCacheTag(tenantId));

  return {
    message: t("admin.settings.webhooks.deliveries.resent"),
    ok: true,
  };
};
