import type { AdminReader } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";

import { READER_STATUSES } from "../app/[tenant_id]/(protected)/readers/reader-types";
import type {
  GetReaderResult,
  ListReadersResult,
  ReaderDetail,
  ReaderItem,
  ReaderStatus,
} from "../app/[tenant_id]/(protected)/readers/reader-types";
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
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

/*
 * Neither read is cached: readers sign up on the storefront, and nothing on
 * that path can drop a cache entry web-admin holds.
 */

const readerStatuses: ReadonlySet<string> = new Set(READER_STATUSES);

/**
 * The stored state, or `inactive` for a value this build does not know, so an
 * account whose state cannot be read is never presented as one in good
 * standing.
 */
const toReaderStatus = (raw: string): ReaderStatus =>
  readerStatuses.has(raw) ? (raw as ReaderStatus) : "inactive";

/** The generated `AdminReader` fields {@link mapReader} reads (see `series.ts`). */
type RawReader = Pick<
  AdminReader,
  "createdAt" | "email" | "name" | "publicId" | "status"
>;

const mapReader = (item: RawReader): ReaderItem => ({
  createdAt: item.createdAt ?? "",
  email: item.email ?? "",
  name: item.name ?? "",
  publicId: item.publicId ?? "",
  status: toReaderStatus(item.status ?? ""),
});

export interface ListReadersFilters extends CursorPageOptions {
  /** A case-insensitive substring of the name or the email. */
  query?: string;
  /** Empty lists every state. */
  status?: string;
}

/** One page of the tenant's readers, newest sign-up first. */
export const listReaders = async (
  tenantId: string,
  locale: Locale,
  filters: ListReadersFilters = {}
): Promise<ListReadersResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      readers: [],
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.users.listReaders(
      {
        ...cursorPageRequest(filters),
        query: filters.query?.trim() ?? "",
        status: filters.status?.trim() ?? "",
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      ok: true,
      readers: (response.readers ?? []).map((item) => mapReader(item)),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      message: rpcErrorMessage(error, t("admin.readers.list_failed"), {
        locale,
      }),
      ok: false,
      readers: [],
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/** The generated `AdminReader` fields {@link mapReaderDetail} reads. */
type RawReaderDetail = RawReader &
  Pick<AdminReader, "birthDate" | "emailVerifiedAt">;

const mapReaderDetail = (item: RawReaderDetail): ReaderDetail => ({
  ...mapReader(item),
  birthDate: item.birthDate ?? "",
  emailVerifiedAt: item.emailVerifiedAt ?? "",
});

/** One reader's account. */
export const getReader = async (
  tenantId: string,
  locale: Locale,
  publicId: string
): Promise<GetReaderResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.users.getReader(
      { publicId, tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );
    if (!response.reader?.publicId) {
      return {
        message: t("admin.readers.detail_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }

    return { ok: true, reader: mapReaderDetail(response.reader) };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }
    return {
      message: rpcErrorMessage(error, t("admin.readers.detail_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export type ReaderModerationAction = "delete" | "suspend" | "unsuspend";

export interface ModerateReaderInput {
  action: ReaderModerationAction;
  publicId: string;
  tenantId: string;
}

export type ModerateReaderResult =
  | { message: string; ok: false }
  | { ok: true };

const callReaderModeration = async (
  input: ModerateReaderInput,
  sessionId: string
): Promise<void> => {
  const request = {
    publicId: input.publicId,
    tenant: { tenantId: input.tenantId },
  };
  const headers = withSessionHeaders(sessionId);

  switch (input.action) {
    case "suspend": {
      await apiClient.users.suspendReader(request, headers);
      return;
    }
    case "unsuspend": {
      await apiClient.users.unsuspendReader(request, headers);
      return;
    }
    default: {
      await apiClient.users.deleteReader(request, headers);
    }
  }
};

const readerModerationFailedMessage = async (
  action: ReaderModerationAction,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  switch (action) {
    case "suspend": {
      return t("admin.readers.suspend_failed");
    }
    case "unsuspend": {
      return t("admin.readers.unsuspend_failed");
    }
    default: {
      return t("admin.readers.delete_failed");
    }
  }
};

export interface SetReaderBirthDateInput {
  /** `YYYY-MM-DD`, or empty to clear the stored date. */
  birthDate: string;
  publicId: string;
  tenantId: string;
}

/**
 * Sets or clears one reader's birth date. A rejected session leaves as a throw
 * so the Action can send the staff member to sign in again.
 */
export const setReaderBirthDate = async (
  input: SetReaderBirthDateInput,
  locale: Locale
): Promise<ModerateReaderResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.users.setReaderBirthDate(
      {
        birthDate: input.birthDate,
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("admin.readers.birth_date_failed"), {
        locale,
        // The date is the only field staff type, so a refusal is about it.
        overrides: {
          "invalid-argument": t("admin.readers.birth_date_invalid"),
        },
      }),
      ok: false,
    };
  }
};

/**
 * Suspend, unsuspend or delete one reader. A rejected session leaves as a throw
 * so the Action can send the staff member to sign in again.
 */
export const moderateReader = async (
  input: ModerateReaderInput,
  locale: Locale
): Promise<ModerateReaderResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await callReaderModeration(input, sessionId);
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        await readerModerationFailedMessage(input.action, locale),
        { locale }
      ),
      ok: false,
    };
  }
};
