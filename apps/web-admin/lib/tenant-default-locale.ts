import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
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

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
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
        message: t("admin.settings.default_locale.load_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }

    return { defaultLocale, ok: true };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.default_locale.load_failed"),
        {
          locale,
        }
      ),
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
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
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
      return {
        message: t("admin.settings.default_locale.save_failed"),
        ok: false,
      };
    }

    return { defaultLocale: saved, ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.default_locale.save_failed"),
        {
          locale,
        }
      ),
      ok: false,
    };
  }
};
