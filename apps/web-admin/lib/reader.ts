import type { AdminReader } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";

import { READER_STATUSES } from "../app/[tenant_id]/(protected)/readers/reader-types";
import type {
  ListReadersResult,
  ReaderItem,
  ReaderStatus,
} from "../app/[tenant_id]/(protected)/readers/reader-types";
import { isUnauthenticatedError } from "./admin-auth-shared";
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
 * The list is not cached: readers sign up on the storefront, and nothing on
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
