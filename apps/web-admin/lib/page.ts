import type { Page, PageVersion } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isMissingResourceRpcError,
  isRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { getAccessToken } from "./session";

export interface PageItem {
  id: string;
  slug: string;
  title: string;
  publishedVersionId: string;
  displayInFooter: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PageVersionItem {
  id: string;
  pageId: string;
  versionNumber: number;
  contentMarkdown: string;
  authorUserId: string;
  status: "draft" | "published";
  publishAt: string;
  createdAt: string;
  publishedAt: string;
}

export type ListPagesResult = CursorPageTokens &
  (
    | { ok: true; pages: PageItem[] }
    | {
        ok: false;
        message: string;
        pages: PageItem[];
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

/**
 * `notFound: true` is the "there is nothing to show here" failure the edit
 * screen turns into `notFound()`. It carries no message: the screen is replaced
 * by `not-found.tsx`, and wording that distinguished a missing page from
 * another tenant's page would leak whether it exists.
 *
 * The flag exists because `getPage()` runs inside a `"use cache: private"`
 * scope, where a thrown `notFound()` is not observable by the caller (#672).
 * The interrupt has to be raised by the caller, outside the cache scope.
 */
export type GetPageResult =
  | { ok: true; page: PageItem }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn?: boolean;
    };

export type ListPageVersionsResult =
  | { ok: true; versions: PageVersionItem[] }
  | {
      ok: false;
      message: string;
      versions: PageVersionItem[];
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export type CreatePageResult =
  | { ok: true; page: PageItem }
  | { ok: false; message: string };

export type UpdatePageResult =
  | { ok: true; page: PageItem }
  | { ok: false; message: string };

export type CreatePageVersionResult =
  | { ok: true; version: PageVersionItem }
  | { ok: false; message: string };

export type PublishPageVersionResult =
  | { ok: true; version: PageVersionItem }
  | { ok: false; message: string };

export type RollbackPageVersionResult =
  | { ok: true; version: PageVersionItem }
  | { ok: false; message: string };

const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");
const listErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.pages.list_failed");
const mutationErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.pages.save_failed");

const mapErrorToMessage = (
  error: unknown,
  fallbackMessage: string,
  locale: Locale
): string => {
  const messages = sharedCatalog(locale);

  return rpcErrorMessage(error, fallbackMessage, {
    locale,
    overrides: {
      conflict: getMessage(messages, "admin.pages.slug_conflict"),
      // A page form is slug + title + body; only the slug has a format rule
      // worth spelling out, and the server identifies it in BadRequest details.
      "invalid-argument": rpcErrorHasFieldViolation(error, "slug")
        ? getMessage(messages, "admin.pages.slug_invalid")
        : getMessage(messages, "errors.validation"),
      "not-found": getMessage(messages, "admin.pages.not_found"),
    },
  });
};

/** The generated `Page` fields {@link mapPage} reads (see `series.ts`). */
type RawPage = Pick<
  Page,
  | "createdAt"
  | "displayInFooter"
  | "id"
  | "publishedVersionId"
  | "slug"
  | "title"
  | "updatedAt"
>;

const mapPage = (page: RawPage): PageItem => ({
  createdAt: page.createdAt ?? "",
  displayInFooter: page.displayInFooter === true,
  id: page.id,
  publishedVersionId: page.publishedVersionId ?? "",
  slug: page.slug,
  title: page.title,
  updatedAt: page.updatedAt ?? "",
});

/** The generated `PageVersion` fields {@link mapPageVersion} reads (see `series.ts`). */
type RawPageVersion = Pick<
  PageVersion,
  | "authorUserId"
  | "contentMarkdown"
  | "createdAt"
  | "id"
  | "pageId"
  | "publishAt"
  | "publishedAt"
  | "status"
  | "versionNumber"
>;

const mapPageVersion = (version: RawPageVersion): PageVersionItem => ({
  authorUserId: version.authorUserId ?? "",
  contentMarkdown: version.contentMarkdown,
  createdAt: version.createdAt ?? "",
  id: version.id,
  pageId: version.pageId,
  publishAt: version.publishAt ?? "",
  publishedAt: version.publishedAt ?? "",
  status: version.status === "published" ? "published" : "draft",
  versionNumber: version.versionNumber,
});

/**
 * One page of the tenant's fixed pages, oldest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` ascending).
 * Sorting them here would only sort the rows that happen to share a page, which
 * reads as a broken order as soon as the list spans more than one page.
 */
export const listPages = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions = {}
): Promise<ListPagesResult> => {
  "use cache: private";
  cacheTag(`pages-${tenantId}`);

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      message: sessionErrorMessage(messages),
      ok: false,
      pages: [],
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.pages.listPages(
      {
        ...cursorPageRequest(options),
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      ok: true,
      pages: (response.pages ?? []).map((page) => mapPage(page)),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
      ok: false,
      pages: [],
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const getPage = async (
  input: {
    tenantId: string;
    pageId: string;
  },
  locale: Locale
): Promise<GetPageResult> => {
  "use cache: private";
  cacheTag(`pages-${input.tenantId}`);
  cacheTag(`page-${input.tenantId}-${input.pageId}`);

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.pages.getPage(
      {
        pageId: input.pageId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.page?.id?.trim()) {
      return { notFound: true, ok: false };
    }

    return {
      ok: true,
      page: mapPage(response.page),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    // `invalid_argument` counts as missing here. This endpoint takes only the
    // tenant and the `[page_id]` segment, and the tenant is always a UUID
    // written by `proxy.ts`, so the only input the server can reject is the id
    // in the URL — "that is not a page id" and "there is no such page" are the
    // same answer to the operator. (`server/api/adminapi/page_handlers.go`
    // `parsePageID`.)
    if (
      isMissingResourceRpcError(error) ||
      isRpcError(error, Code.InvalidArgument)
    ) {
      return { notFound: true, ok: false };
    }
    return {
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const listPageVersions = async (
  input: {
    tenantId: string;
    pageId: string;
  },
  locale: Locale
): Promise<ListPageVersionsResult> => {
  "use cache: private";
  cacheTag(`page-${input.tenantId}-${input.pageId}`);

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
      versions: [],
    };
  }

  try {
    const response = await apiClient.pages.listVersions(
      {
        pageId: input.pageId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      versions: (response.versions ?? []).map((version) =>
        mapPageVersion(version)
      ),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      versions: [],
    };
  }
};

export const createPage = async (
  input: {
    tenantId: string;
    slug: string;
    title: string;
    displayInFooter?: boolean;
  },
  locale: Locale
): Promise<CreatePageResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    const response = await apiClient.pages.createPage(
      {
        displayInFooter: input.displayInFooter === true,
        slug: input.slug,
        tenant: { tenantId: input.tenantId },
        title: input.title,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.page?.id?.trim()) {
      return {
        message: mutationErrorMessage(messages),
        ok: false,
      };
    }

    return {
      ok: true,
      page: mapPage(response.page),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, mutationErrorMessage(messages), locale),
      ok: false,
    };
  }
};

export const updatePage = async (
  input: {
    tenantId: string;
    pageId: string;
    title: string;
    displayInFooter?: boolean;
  },
  locale: Locale
): Promise<UpdatePageResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    // Omit displayInFooter when unset so title-only updates keep the existing value.
    const response = await apiClient.pages.updatePage(
      {
        ...(input.displayInFooter === undefined
          ? {}
          : { displayInFooter: input.displayInFooter }),
        pageId: input.pageId,
        tenant: { tenantId: input.tenantId },
        title: input.title,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.page?.id?.trim()) {
      return {
        message: mutationErrorMessage(messages),
        ok: false,
      };
    }

    return {
      ok: true,
      page: mapPage(response.page),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, mutationErrorMessage(messages), locale),
      ok: false,
    };
  }
};

export const createPageVersion = async (
  input: {
    tenantId: string;
    pageId: string;
    contentMarkdown: string;
  },
  locale: Locale
): Promise<CreatePageVersionResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    const response = await apiClient.pages.createVersion(
      {
        contentMarkdown: input.contentMarkdown,
        pageId: input.pageId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.version?.id?.trim()) {
      return {
        message: mutationErrorMessage(messages),
        ok: false,
      };
    }

    return {
      ok: true,
      version: mapPageVersion(response.version),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, mutationErrorMessage(messages), locale),
      ok: false,
    };
  }
};

export const publishPageVersion = async (
  input: {
    tenantId: string;
    pageId: string;
    versionId: string;
  },
  locale: Locale
): Promise<PublishPageVersionResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    const response = await apiClient.pages.publishVersion(
      {
        pageId: input.pageId,
        tenant: { tenantId: input.tenantId },
        versionId: input.versionId,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.version?.id?.trim()) {
      return {
        message: mutationErrorMessage(messages),
        ok: false,
      };
    }

    return {
      ok: true,
      version: mapPageVersion(response.version),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, mutationErrorMessage(messages), locale),
      ok: false,
    };
  }
};

export const rollbackPageVersion = async (
  input: {
    tenantId: string;
    pageId: string;
    versionId: string;
  },
  locale: Locale
): Promise<RollbackPageVersionResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    const response = await apiClient.pages.rollbackToVersion(
      {
        pageId: input.pageId,
        tenant: { tenantId: input.tenantId },
        versionId: input.versionId,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.version?.id?.trim()) {
      return {
        message: mutationErrorMessage(messages),
        ok: false,
      };
    }

    return {
      ok: true,
      version: mapPageVersion(response.version),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, mutationErrorMessage(messages), locale),
      ok: false,
    };
  }
};
