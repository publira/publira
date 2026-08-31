import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { getMessage, parseLocale } from "@publira/i18n";
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
      /**
       * No `defaultLocale`. A read that failed has no saved language to report,
       * and the settings screen would otherwise offer to save a value nobody
       * chose over the stored one.
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

const resolveDefaultLocale = (value: string | undefined): Locale | undefined =>
  parseLocale(value?.trim());

export const getTenantDefaultLocale = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantDefaultLocaleResult> => {
  "use cache: private";

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
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

    const defaultLocale = resolveDefaultLocale(response.defaultLocale);
    if (defaultLocale === undefined) {
      return {
        message: genericLoadErrorMessage(messages),
        ok: false,
        requiresSignIn: false,
      };
    }

    return { defaultLocale, ok: true };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, genericLoadErrorMessage(messages), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const updateTenantDefaultLocale = async (
  input: {
    tenantId: string;
    defaultLocale: Locale;
  },
  locale: Locale
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
    const saved = resolveDefaultLocale(response.defaultLocale);
    if (saved === undefined) {
      return { message: genericUpdateErrorMessage(messages), ok: false };
    }

    return { defaultLocale: saved, ok: true };
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
