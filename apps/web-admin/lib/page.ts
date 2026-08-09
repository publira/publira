import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorMentions,
} from "@publira/api-client/errors";
import { cacheTag } from "next/cache";

import { apiClient, withSessionHeaders } from "./api";
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

export type ListPagesResult =
  | { ok: true; pages: PageItem[] }
  | { ok: false; message: string; pages: PageItem[] };

export type GetPageResult =
  | { ok: true; page: PageItem }
  | { ok: false; message: string };

export type ListPageVersionsResult =
  | { ok: true; versions: PageVersionItem[] }
  | { ok: false; message: string; versions: PageVersionItem[] };

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

const genericListErrorMessage =
  "ページ情報の取得に失敗しました。時間をおいて再試行してください。";
const genericMutationErrorMessage =
  "ページ情報の保存に失敗しました。時間をおいて再試行してください。";

const mapErrorToMessage = (error: unknown, fallbackMessage: string): string =>
  rpcErrorMessage(error, fallbackMessage, {
    conflict:
      "同じ slug のページが既に存在します。別の slug を指定してください。",
    // A page form is slug + title + body; only the slug has a format rule
    // worth spelling out, and the server names it in the message.
    "invalid-argument": rpcErrorMentions(error, "slug")
      ? "slug は空欄、または / で始まる半角小文字・数字・ハイフンで入力してください。"
      : "入力内容を確認してください。",
    "not-found":
      "対象のページまたはバージョンが見つかりませんでした。ページを再読み込みしてください。",
  });

const mapPage = (page: {
  id: string;
  slug: string;
  title: string;
  publishedVersionId?: string;
  displayInFooter?: boolean;
  createdAt?: string;
  updatedAt?: string;
}): PageItem => ({
  createdAt: page.createdAt ?? "",
  displayInFooter: page.displayInFooter === true,
  id: page.id,
  publishedVersionId: page.publishedVersionId ?? "",
  slug: page.slug,
  title: page.title,
  updatedAt: page.updatedAt ?? "",
});

const mapPageVersion = (version: {
  id: string;
  pageId: string;
  versionNumber: number;
  contentMarkdown: string;
  authorUserId?: string;
  status?: string;
  publishAt?: string;
  createdAt?: string;
  publishedAt?: string;
}): PageVersionItem => ({
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

export const listPages = async (tenantId: string): Promise<ListPagesResult> => {
  "use cache: private";
  cacheTag(`pages-${tenantId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      pages: [],
    };
  }

  try {
    const response = await apiClient.pages.listPages(
      { tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      pages: (response.pages ?? []).map((page) => mapPage(page)),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
      pages: [],
    };
  }
};

export const getPage = async (input: {
  tenantId: string;
  pageId: string;
}): Promise<GetPageResult> => {
  "use cache: private";
  cacheTag(`pages-${input.tenantId}`);
  cacheTag(`page-${input.tenantId}-${input.pageId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
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
      return {
        message: "ページが見つかりません。",
        ok: false,
      };
    }

    return {
      ok: true,
      page: mapPage(response.page),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
    };
  }
};

export const listPageVersions = async (input: {
  tenantId: string;
  pageId: string;
}): Promise<ListPageVersionsResult> => {
  "use cache: private";
  cacheTag(`page-${input.tenantId}-${input.pageId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
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
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
      versions: [],
    };
  }
};

export const createPage = async (input: {
  tenantId: string;
  slug: string;
  title: string;
  displayInFooter?: boolean;
}): Promise<CreatePageResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
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
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      ok: true,
      page: mapPage(response.page),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};

export const updatePage = async (input: {
  tenantId: string;
  pageId: string;
  title: string;
  displayInFooter?: boolean;
}): Promise<UpdatePageResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
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
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      ok: true,
      page: mapPage(response.page),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};

export const createPageVersion = async (input: {
  tenantId: string;
  pageId: string;
  contentMarkdown: string;
}): Promise<CreatePageVersionResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
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
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      ok: true,
      version: mapPageVersion(response.version),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};

export const publishPageVersion = async (input: {
  tenantId: string;
  pageId: string;
  versionId: string;
}): Promise<PublishPageVersionResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
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
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      ok: true,
      version: mapPageVersion(response.version),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};

export const rollbackPageVersion = async (input: {
  tenantId: string;
  pageId: string;
  versionId: string;
}): Promise<RollbackPageVersionResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
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
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      ok: true,
      version: mapPageVersion(response.version),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};
