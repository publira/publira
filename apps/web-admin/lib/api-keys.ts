import { ApiKeyScope } from "@publira/api-client/admin/api-key";
import type { ApiKey } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

/** What a key may read: the catalog, or the purchases and their buyers. */
export const API_KEY_SCOPES = ["catalog", "purchases"] as const;

export type ApiKeyScopeValue = (typeof API_KEY_SCOPES)[number];

const scopeValues: Partial<Record<ApiKeyScope, ApiKeyScopeValue>> = {
  [ApiKeyScope.CATALOG_READ]: "catalog",
  [ApiKeyScope.PURCHASES_READ]: "purchases",
};

const rpcScopes: Record<ApiKeyScopeValue, ApiKeyScope> = {
  catalog: ApiKeyScope.CATALOG_READ,
  purchases: ApiKeyScope.PURCHASES_READ,
};

/** What the console shows of a key once it is created: never the key itself. */
export interface ApiKeyItem {
  createdAt: string;
  id: string;
  /** RFC 3339, to the minute; empty for a key never used. */
  lastUsedAt: string;
  name: string;
  /** `pbk_` and the twelve characters after it. */
  prefix: string;
  /** RFC 3339; empty while the key is in use. */
  revokedAt: string;
  scopes: ApiKeyScopeValue[];
}

export type ListApiKeysResult =
  | { apiKeys: ApiKeyItem[]; ok: true }
  | {
      apiKeys: ApiKeyItem[];
      message: string;
      ok: false;
      requiresSignIn?: boolean;
    };

export type CreateApiKeyResult =
  | { apiKey: ApiKeyItem; key: string; ok: true }
  | { message: string; ok: false };

export type RevokeApiKeyResult =
  | { apiKey: ApiKeyItem; ok: true }
  | { message: string; ok: false };

/**
 * The tag the key list carries. A request made with a key moves its
 * `last_used_at` without this console, so the list also declares
 * `cacheLife("minutes")`.
 */
export const apiKeysCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:api-keys`;

type RawApiKey = Pick<
  ApiKey,
  "createdAt" | "id" | "lastUsedAt" | "name" | "prefix" | "revokedAt" | "scopes"
>;

const toApiKeyItem = (key: RawApiKey): ApiKeyItem => ({
  createdAt: key.createdAt ?? "",
  id: key.id ?? "",
  lastUsedAt: key.lastUsedAt ?? "",
  name: key.name ?? "",
  prefix: key.prefix ?? "",
  revokedAt: key.revokedAt ?? "",
  // A scope a newer server added is one this console has no word for, so it
  // is left off rather than shown as something it is not.
  scopes: (key.scopes ?? []).flatMap((scope) => {
    const value = scopeValues[scope];

    return value ? [value] : [];
  }),
});

const listApiKeysForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<ListApiKeysResult>> => {
  "use cache: private";

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();

    return {
      apiKeys: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(apiKeysCacheTag(normalizedTenantId));
  cacheLife("minutes");

  try {
    const response = await apiClient.apiKeys.listApiKeys(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { apiKeys: response.apiKeys.map(toApiKeyItem), ok: true };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      apiKeys: [],
      message: rpcErrorMessage(
        error,
        t("admin.settings.api_keys.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** Every key of the tenant's, revoked ones included, newest first. */
export const listApiKeys = async (
  tenantId: string,
  locale: Locale
): Promise<ListApiKeysResult> =>
  settleCachedRead(
    await listApiKeysForSession(tenantId, locale, await getAccessToken())
  );

export interface CreateApiKeyInput {
  name: string;
  scopes: readonly ApiKeyScopeValue[];
  tenantId: string;
}

/**
 * Creates a key and answers it whole, the one time it exists outside the
 * server: only its hash is kept there.
 */
export const createApiKey = async (
  input: CreateApiKeyInput,
  locale: Locale
): Promise<CreateApiKeyResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.apiKeys.createApiKey(
      {
        name: input.name,
        scopes: input.scopes.map((scope) => rpcScopes[scope]),
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.apiKey || !response.key) {
      return {
        message: t("admin.settings.api_keys.create_failed"),
        ok: false,
      };
    }

    return {
      apiKey: toApiKeyItem(response.apiKey),
      key: response.key,
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    let invalidArgument = t("admin.settings.api_keys.validation.invalid");

    if (rpcErrorHasFieldViolation(error, "name")) {
      invalidArgument = t("admin.settings.api_keys.validation.name_length");
    } else if (rpcErrorHasFieldViolation(error, "scopes")) {
      invalidArgument = t("admin.settings.api_keys.validation.scopes_required");
    }

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.api_keys.create_failed"),
        { locale, overrides: { "invalid-argument": invalidArgument } }
      ),
      ok: false,
    };
  }
};

/** Refuses the key from now on. One already revoked is answered as it stands. */
export const revokeApiKey = async (
  tenantId: string,
  apiKeyId: string,
  locale: Locale
): Promise<RevokeApiKeyResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.apiKeys.revokeApiKey(
      { apiKeyId, tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    if (!response.apiKey) {
      return {
        message: t("admin.settings.api_keys.revoke_failed"),
        ok: false,
      };
    }

    return { apiKey: toApiKeyItem(response.apiKey), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.api_keys.revoke_failed"),
        {
          locale,
          overrides: {
            "not-found": t("admin.settings.api_keys.already_gone"),
          },
        }
      ),
      ok: false,
    };
  }
};
