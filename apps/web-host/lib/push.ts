/**
 * The signed-in reader's browser subscription, as the server holds it.
 *
 * `locale` reaches both calls as an argument so the failure wording belongs to
 * the request rather than to whichever cookie the Server Action happened to be
 * able to read.
 */

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { PushPlatform } from "@publira/api-client/public/notification";
import type { Locale } from "@publira/i18n";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import type { WebPushSubscriptionKeys } from "./browser-push";
import { getMessagesFor } from "./messages";

export type PushDeviceResult = { message: string; ok: false } | { ok: true };

/**
 * Register this browser's subscription against the signed-in reader.
 *
 * The endpoint is the identity on the server, so re-registering one a previous
 * reader left in the same browser moves it to whoever is signed in now rather
 * than adding a second registration that would push their episodes here.
 */
export const registerWebPushDevice = async (input: {
  locale: Locale;
  subscription: WebPushSubscriptionKeys;
  tenantId: string;
}): Promise<PushDeviceResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(input.locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.notification.registerPushDevice(
      {
        auth: input.subscription.auth,
        endpoint: input.subscription.endpoint,
        p256dh: input.subscription.p256dh,
        platform: PushPlatform.WEB,
        tenant: { tenantId: input.tenantId },
      },
      buildSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("host.settings.browser_notifications_failed"),
        { locale: input.locale }
      ),
      ok: false,
    };
  }
};

/**
 * Take this browser off the delivery list. The endpoint identifies a web
 * registration, so the caller needs nothing the browser does not already hold.
 */
export const unregisterWebPushDevice = async (input: {
  endpoint: string;
  locale: Locale;
  tenantId: string;
}): Promise<PushDeviceResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(input.locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.notification.unregisterPushDevice(
      {
        endpoint: input.endpoint,
        tenant: { tenantId: input.tenantId },
      },
      buildSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("host.settings.browser_notifications_off_failed"),
        { locale: input.locale }
      ),
      ok: false,
    };
  }
};
