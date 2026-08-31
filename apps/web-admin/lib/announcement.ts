import type {
  AdminAnnouncement,
  AdminTenantUser,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { getMessage, toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cacheTag } from "next/cache";

import type {
  ListAnnouncementsResult,
  ListAnnouncementTargetUsersResult,
  AnnouncementItem,
  AnnouncementTargetUser,
} from "../app/[tenant_id]/(protected)/announcements/announcement-types";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { FALLBACK_LOCALE } from "./fallback-locale";
import { getAccessToken } from "./session";

const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");
const listErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.announcements.list_failed");
const createErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.announcements.create_failed");
const targetUsersErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.announcements.target_users_failed");
const audienceTypeAllUsers = 1;
const audienceTypeSelectedUsers = 2;

const mapErrorMessage = (
  error: unknown,
  fallback: string,
  locale: Locale
): string => rpcErrorMessage(error, fallback, { locale });

/** The generated `AdminAnnouncement` fields {@link mapAnnouncement} reads (see `series.ts`). */
type RawAnnouncement = Pick<
  AdminAnnouncement,
  | "audienceType"
  | "body"
  | "createdAt"
  | "id"
  | "linkUrl"
  | "targetUserName"
  | "targetUserPublicId"
  | "title"
>;

const mapAnnouncement = (item: RawAnnouncement): AnnouncementItem => ({
  audienceType:
    item.audienceType === audienceTypeSelectedUsers ? "selected" : "all",
  body: item.body,
  createdAt: item.createdAt,
  id: item.id,
  linkUrl: item.linkUrl,
  targetUserName: item.targetUserName,
  targetUserPublicId: item.targetUserPublicId,
  title: item.title,
});

/** The generated `AdminTenantUser` fields {@link mapUser} reads (see `series.ts`). */
type RawAnnouncementTargetUser = Pick<AdminTenantUser, "name" | "publicId">;

const mapUser = (user: RawAnnouncementTargetUser): AnnouncementTargetUser => ({
  name: user.name,
  publicId: user.publicId,
});

/**
 * Every user an announcement can be addressed to.
 *
 * Walks `ListTenantUsers` cursor pages so the create form offers members past
 * the first page too. Sorted by name once the whole set is in hand; sorting a
 * single page would only order the rows that page happened to hold.
 *
 * Deliberately uncached: nothing in this app invalidates a tenant's member
 * list, so a cache tag here would keep a newly added member out of the picker
 * until the entry expired.
 */
export const listAllAnnouncementTargetUsers = async (
  tenantId: string,
  locale: Locale = FALLBACK_LOCALE
): Promise<ListAnnouncementTargetUsersResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
      users: [],
    };
  }

  try {
    const users: AnnouncementTargetUser[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.users.listTenantUsers(
          {
            limit,
            query: "",
            tenant: { tenantId },
            token,
          },
          withSessionHeaders(sessionId)
        );
        return {
          items: response.users ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          if (item.publicId.trim() !== "") {
            users.push(mapUser(item));
          }
        }
      }
    );

    // Match the series pickers: a partial walk must not surface a half-built
    // option list that operators read as the whole tenant.
    if (walkStop !== "completed") {
      return {
        message: targetUsersErrorMessage(messages),
        ok: false,
        requiresSignIn: false,
        users: [],
      };
    }

    return {
      ok: true,
      users: users.toSorted((a, b) =>
        a.name.localeCompare(b.name, toIntlLocale(locale))
      ),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(
        error,
        targetUsersErrorMessage(messages),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      users: [],
    };
  }
};

/**
 * One page of the tenant's announcements, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page, which
 * reads as a broken order as soon as the list spans more than one page.
 */
export const listAnnouncements = async (
  tenantId: string,
  options: CursorPageOptions = {},
  locale: Locale = FALLBACK_LOCALE
): Promise<ListAnnouncementsResult> => {
  "use cache: private";
  cacheTag(`announcements-${tenantId}`);

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      announcements: [],
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.announcement.listAnnouncements(
      {
        ...cursorPageRequest(options),
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      announcements: (response.announcements ?? []).map((item) =>
        mapAnnouncement(item)
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      announcements: [],
      message: mapErrorMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const createAnnouncement = async (
  input: {
    tenantId: string;
    title: string;
    body: string;
    linkUrl: string;
    audienceType: "all" | "selected";
    targetUserPublicIds: string[];
  },
  locale: Locale = FALLBACK_LOCALE
): Promise<
  { ok: true; createdCount: number } | { ok: false; message: string }
> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  const audienceTypeEnum =
    input.audienceType === "selected"
      ? audienceTypeSelectedUsers
      : audienceTypeAllUsers;

  try {
    const response = await apiClient.announcement.createAnnouncement(
      {
        audienceType: audienceTypeEnum,
        body: input.body,
        linkUrl: input.linkUrl,
        targetUserPublicIds: input.targetUserPublicIds,
        tenant: { tenantId: input.tenantId },
        title: input.title,
      },
      withSessionHeaders(sessionId)
    );

    return {
      createdCount: response.announcements?.length ?? 0,
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(error, createErrorMessage(messages), locale),
      ok: false,
    };
  }
};
