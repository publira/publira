"use server";

import { validationErrorMessage } from "@publira/utils/field-errors";
import { z } from "zod";

import { tenantIdSchema } from "./auth-input";
import { requirePublicSession, withPublicSessionReauth } from "./auth-session";
import { assertSameOrigin } from "./csrf";
import { localeFormSchema, requireFormLocale } from "./locale-form";
import type { PushDeviceResult } from "./push";
import { registerWebPushDevice, unregisterWebPushDevice } from "./push";

const NOTIFICATION_SETTINGS_RETURN_TO = "/settings/notifications";

/**
 * A push service endpoint. The length bound is the server's own
 * (`maxPushDeviceTokenBytes`, and the column's byte limit behind it), so an
 * over-long value is refused here rather than crossing the network to be
 * refused there.
 */
const endpointSchema = z.url({ protocol: /^https$/u }).max(1024);

/** The subscription key material, which is base64url of a fixed size. */
const subscriptionKeySchema = z.string().trim().min(1).max(1024);

const registerInputSchema = z.object({
  auth: subscriptionKeySchema,
  endpoint: endpointSchema,
  locale: localeFormSchema,
  p256dh: subscriptionKeySchema,
  tenantId: tenantIdSchema,
});

const unregisterInputSchema = z.object({
  endpoint: endpointSchema,
  locale: localeFormSchema,
  tenantId: tenantIdSchema,
});

/**
 * Both actions take the tenant and the locale as arguments rather than reading
 * them back from the request: an Action cannot see `next/root-params`, and a
 * cookie read would let the call be worded in a language the screen that made
 * it is not rendered in.
 */
export type BrowserPushInput = z.input<typeof registerInputSchema>;

/**
 * The locale an Action words its rejection in, read before the schema has said
 * anything about the shape around it.
 *
 * An Action's parameter type describes what this app's own call sites pass, not
 * what reaches the endpoint: anything that can POST to it decides the runtime
 * value. So the read is written against `unknown` — `input.locale` on a `null`
 * body would throw a `TypeError` where the reader should have been handed a
 * validation message.
 */
const requireInputLocale = (input: unknown) =>
  requireFormLocale(
    typeof input === "object" && input !== null && "locale" in input
      ? input.locale
      : undefined
  );

export const registerBrowserPushAction = async (
  input: BrowserPushInput
): Promise<PushDeviceResult> => {
  await assertSameOrigin();
  // Read first, so a rejected subscription is still worded in the reader's
  // language.
  const submittedLocale = requireInputLocale(input);
  const parsed = registerInputSchema.safeParse(input);
  if (!parsed.success) {
    return { message: validationErrorMessage(submittedLocale), ok: false };
  }

  const { locale, tenantId, ...subscription } = parsed.data;
  await requirePublicSession(locale, NOTIFICATION_SETTINGS_RETURN_TO, tenantId);

  return await withPublicSessionReauth(
    locale,
    NOTIFICATION_SETTINGS_RETURN_TO,
    () => registerWebPushDevice({ locale, subscription, tenantId }),
    tenantId
  );
};

/**
 * Take this browser off the delivery list.
 *
 * Unlike the registration this does **not** require a session: signing out
 * calls it, and by then the reader is on their way to a session that no longer
 * exists. A call with no session is reported as a failure the caller can
 * ignore rather than a redirect that would strand the sign-out on `/login`.
 */
export const unregisterBrowserPushAction = async (
  input: z.input<typeof unregisterInputSchema>
): Promise<PushDeviceResult> => {
  await assertSameOrigin();
  const submittedLocale = requireInputLocale(input);
  const parsed = unregisterInputSchema.safeParse(input);
  if (!parsed.success) {
    return { message: validationErrorMessage(submittedLocale), ok: false };
  }

  const { endpoint, locale, tenantId } = parsed.data;

  return await unregisterWebPushDevice({ endpoint, locale, tenantId });
};
