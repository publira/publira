import { CrawlerPurpose as RpcCrawlerPurpose } from "@publira/api-client/admin/tenant";
import type {
  KnownCrawler as RpcKnownCrawler,
  TenantCrawlerSettings as RpcTenantCrawlerSettings,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";
import type {
  CrawlerPurpose,
  KnownCrawler,
} from "./tenant-crawler-settings-shared";
import { MAX_CRAWLER_EXCLUDED_PATHS } from "./tenant-crawler-settings-shared";

/** What the tenant's robots.txt excludes. */
export interface TenantCrawlerSettings {
  /** Tokens of known crawlers, each refused every path, in the server's order. */
  excludedUserAgents: string[];
  /** Paths refused to every crawler, normalized by the server, in lexical order. */
  excludedPaths: string[];
}

export type TenantCrawlerSettingsResult =
  | {
      ok: true;
      settings: TenantCrawlerSettings;
      /** Every crawler the setting may name, grouped by purpose. */
      knownCrawlers: KnownCrawler[];
    }
  | {
      ok: false;
      message: string;
      /** Set by the read only; the update path throws instead. */
      requiresSignIn?: boolean;
    };

/** Refusals worded for the part of the card each belongs to. */
export type TenantCrawlerSettingsFieldErrors = Partial<
  Record<"excludedPaths" | "excludedUserAgents", string>
>;

export type UpdateTenantCrawlerSettingsResult =
  | { ok: true; settings: TenantCrawlerSettings }
  | {
      ok: false;
      message: string;
      fieldErrors?: TenantCrawlerSettingsFieldErrors;
    };

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved exclusions visible in the same session instead of
 * leaving the previous ones in the private cache.
 */
export const tenantCrawlerSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:crawler-settings`;

type RawTenantCrawlerSettings = Pick<
  RpcTenantCrawlerSettings,
  "excludedPaths" | "excludedUserAgents"
>;

type RawKnownCrawler = Pick<
  RpcKnownCrawler,
  "operator" | "purpose" | "userAgent"
>;

const toCrawlerPurpose = (purpose: RpcCrawlerPurpose): CrawlerPurpose => {
  switch (purpose) {
    case RpcCrawlerPurpose.AI_TRAINING: {
      return "ai_training";
    }
    case RpcCrawlerPurpose.AI_ASSISTANT: {
      return "ai_assistant";
    }
    case RpcCrawlerPurpose.IMAGE_SEARCH: {
      return "image_search";
    }
    default: {
      return "other";
    }
  }
};

const toKnownCrawler = (crawler: RawKnownCrawler): KnownCrawler => ({
  operator: crawler.operator ?? "",
  purpose: toCrawlerPurpose(crawler.purpose),
  userAgent: crawler.userAgent ?? "",
});

const toTenantCrawlerSettings = (
  settings?: RawTenantCrawlerSettings
): TenantCrawlerSettings => ({
  excludedPaths: [...(settings?.excludedPaths ?? [])],
  excludedUserAgents: [...(settings?.excludedUserAgents ?? [])],
});

const getTenantCrawlerSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<TenantCrawlerSettingsResult>> => {
  "use cache: private";

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(tenantCrawlerSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantCrawlerSettings(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );
    return {
      knownCrawlers: (response.knownCrawlers ?? []).map(toKnownCrawler),
      ok: true,
      settings: toTenantCrawlerSettings(response.settings),
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.crawlers.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** Read by every role the console admits, and saved by a tenant admin alone. */
export const getTenantCrawlerSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantCrawlerSettingsResult> =>
  settleCachedRead(
    await getTenantCrawlerSettingsForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

/**
 * Which entry the API refused, as the card names it. The Action checks each
 * path by the server's rule first, so a refused path is one the two rules read
 * differently, and a refused crawler is one the server stopped offering while
 * the page was open; the server's answer is the one that stands.
 */
const refusedField = (
  error: unknown,
  input: TenantCrawlerSettings,
  t: Awaited<ReturnType<typeof getMessagesFor>>
):
  | { field: keyof TenantCrawlerSettingsFieldErrors; message: string }
  | undefined => {
  if (rpcErrorHasFieldViolation(error, "settings.excluded_paths")) {
    return {
      field: "excludedPaths",
      message: t("admin.settings.crawlers.validation.too_many", {
        max: MAX_CRAWLER_EXCLUDED_PATHS,
      }),
    };
  }
  const path = input.excludedPaths.find((_, index) =>
    rpcErrorHasFieldViolation(error, `settings.excluded_paths[${index}]`)
  );
  if (path !== undefined) {
    return {
      field: "excludedPaths",
      message: t("admin.settings.crawlers.validation.path_refused", { path }),
    };
  }
  const crawler = input.excludedUserAgents.find((_, index) =>
    rpcErrorHasFieldViolation(error, `settings.excluded_user_agents[${index}]`)
  );
  if (crawler !== undefined) {
    return {
      field: "excludedUserAgents",
      message: t("admin.settings.crawlers.validation.crawler_refused", {
        crawler,
      }),
    };
  }
  return undefined;
};

/** Replaces the whole setting: the lists sent are the lists stored. */
export const updateTenantCrawlerSettings = async (
  input: { tenantId: string } & TenantCrawlerSettings,
  locale: Locale
): Promise<UpdateTenantCrawlerSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantCrawlerSettings(
      {
        settings: {
          excludedPaths: input.excludedPaths,
          excludedUserAgents: input.excludedUserAgents,
        },
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );
    return {
      ok: true,
      settings: toTenantCrawlerSettings(response.settings),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const refused = refusedField(error, input, t);
    if (refused) {
      return {
        fieldErrors: { [refused.field]: refused.message },
        message: refused.message,
        ok: false,
      };
    }
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.crawlers.save_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
