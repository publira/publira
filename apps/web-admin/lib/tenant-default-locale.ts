import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { DEFAULT_LOCALE, getMessage, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

export type GetTenantDefaultLocaleResult =
  | { ok: true; defaultLocale: Locale }
  | {
      ok: false;
      message: string;
      defaultLocale: Locale;
      /**
       * The API rejected the session — the settings screen raises the login
       * redirect. {@link getTenantDisplayLocale} ignores it on purpose: a
       * cookie-less request can still render in the fallback locale without
       * interrupting a page whose own read will report the same rejection.
       */
      requiresSignIn: boolean;
    };

export type UpdateTenantDefaultLocaleResult =
  | { ok: true; defaultLocale: Locale }
  | { ok: false; message: string };

const genericLoadErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.settings.default_locale.load_failed");
const genericUpdateErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.settings.default_locale.save_failed");
const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved value visible in the same session instead of leaving
 * the previous locale in the private cache.
 */
export const tenantDefaultLocaleCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:default-locale`;

const resolveDefaultLocale = (value: string | undefined): Locale =>
  parseLocale(value?.trim());

export const getTenantDefaultLocale = async (
  tenantId: string,
  locale: Locale = DEFAULT_LOCALE
): Promise<GetTenantDefaultLocaleResult> => {
  "use cache: private";

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      defaultLocale: DEFAULT_LOCALE,
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(tenantDefaultLocaleCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantDefaultLocale(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      defaultLocale: resolveDefaultLocale(response.defaultLocale),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      defaultLocale: DEFAULT_LOCALE,
      message: rpcErrorMessage(error, genericLoadErrorMessage(messages), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * Locale the console falls back to when the operator has not chosen one
 * (#1046). One entry point, so a cookie-less request never hard-codes `ja`
 * by omission.
 *
 * An unavailable tenant read degrades to {@link DEFAULT_LOCALE} rather than
 * guessing. The read is tagged `tenant:<id>:default-locale`, which `updateTag`
 * invalidates when the value is saved, so a change reaches every screen in
 * the same session.
 */
export const getTenantDisplayLocale = async (
  tenantId: string
): Promise<Locale> => {
  const result = await getTenantDefaultLocale(tenantId);
  return result.defaultLocale;
};

export const updateTenantDefaultLocale = async (
  input: {
    tenantId: string;
    defaultLocale: Locale;
  },
  locale: Locale = DEFAULT_LOCALE
): Promise<UpdateTenantDefaultLocaleResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantDefaultLocale(
      {
        defaultLocale: input.defaultLocale,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      defaultLocale: resolveDefaultLocale(response.defaultLocale),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, genericUpdateErrorMessage(messages), {
        locale,
      }),
      ok: false,
    };
  }
};
