import type { TenantLegalPage as RpcTenantLegalPage } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";
import type { TenantLegalPages } from "./tenant-legal-pages-shared";

export type TenantLegalPagesResult =
  | { ok: true; pages: TenantLegalPages }
  | {
      ok: false;
      message: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn?: boolean;
    };

/**
 * Tag the settings screen's read carries. The read also carries the page list's
 * tag, because publishing, unpublishing, or renaming a page changes what it
 * reports about a nominated page.
 */
export const tenantLegalPagesCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:legal-pages`;

type RawTenantLegalPage = Pick<
  RpcTenantLegalPage,
  "pageId" | "published" | "slug" | "title"
>;

const toTenantLegalPage = (page: RawTenantLegalPage | undefined) =>
  page?.pageId
    ? {
        pageId: page.pageId,
        published: page.published === true,
        slug: page.slug ?? "",
        title: page.title ?? "",
      }
    : undefined;

const toTenantLegalPages = (
  pages:
    | { termsPage?: RawTenantLegalPage; privacyPage?: RawTenantLegalPage }
    | undefined
): TenantLegalPages => ({
  privacyPage: toTenantLegalPage(pages?.privacyPage),
  termsPage: toTenantLegalPage(pages?.termsPage),
});

export const getTenantLegalPages = async (
  tenantId: string,
  locale: Locale
): Promise<TenantLegalPagesResult> => {
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

  cacheTag(tenantLegalPagesCacheTag(normalizedTenantId));
  cacheTag(`pages-${normalizedTenantId}`);

  try {
    const response = await apiClient.tenantSettings.getTenantLegalPages(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true, pages: toTenantLegalPages(response.pages) };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.legal_pages.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * Writes both nominations. An empty id clears that nomination.
 */
export const updateTenantLegalPages = async (
  input: { tenantId: string; termsPageId: string; privacyPageId: string },
  locale: Locale
): Promise<TenantLegalPagesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantLegalPages(
      {
        privacyPageId: input.privacyPageId,
        tenant: { tenantId: normalizedTenantId },
        termsPageId: input.termsPageId,
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true, pages: toTenantLegalPages(response.pages) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    // The server refuses a page that is not a published page of this tenant,
    // which happens when it was unpublished or deleted after the screen loaded.
    let pageMessage: string | undefined;
    if (rpcErrorHasFieldViolation(error, "terms_page_id")) {
      pageMessage = t(
        "admin.settings.legal_pages.validation.terms_unavailable"
      );
    } else if (rpcErrorHasFieldViolation(error, "privacy_page_id")) {
      pageMessage = t(
        "admin.settings.legal_pages.validation.privacy_unavailable"
      );
    }
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.legal_pages.save_failed"),
        {
          locale,
          overrides: pageMessage
            ? { "invalid-argument": pageMessage }
            : undefined,
        }
      ),
      ok: false,
    };
  }
};
