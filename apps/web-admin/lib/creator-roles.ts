import type { CreatorRole } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { RpcErrorMessageOverrides } from "@publira/api-client/error-messages";
import {
  RPC_ERROR_METADATA,
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorReasonMetadataNumber,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import { rethrowUnauthenticatedRpcError } from "./admin-auth-shared";
import { verifyAdminPageSession } from "./admin-page-session";
import { apiClient, withServiceHeaders, withSessionHeaders } from "./api";
import { CREATOR_ROLE_NAME_MAX_LENGTH } from "./creator-roles-shared";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

export interface CreatorRoleItem {
  /** The primary key every role write addresses the role by. */
  id: string;
  publicId: string;
  name: string;
}

export type ListCreatorRolesResult =
  | { ok: true; creatorRoles: CreatorRoleItem[] }
  | {
      ok: false;
      message: string;
      creatorRoles: CreatorRoleItem[];
    };

export type CreateCreatorRoleResult =
  | { ok: true; creatorRole: CreatorRoleItem }
  | { ok: false; message: string };

export type UpdateCreatorRoleResult =
  | { ok: true; creatorRole: CreatorRoleItem }
  | { ok: false; message: string };

export type ReorderCreatorRolesResult =
  | { ok: true; creatorRoles: CreatorRoleItem[] }
  | { ok: false; message: string };

export type DeleteCreatorRoleResult =
  | { ok: true }
  | { ok: false; message: string };

/** The tag every role read is filed under, and every role write drops. */
export const creatorRolesCacheTag = (tenantId: string): string =>
  `creator-roles-${tenantId}`;

/**
 * The name rules the API enforces, worded once for both writes that carry a
 * name. `invalid-argument` is an empty name or one past the bound, and
 * `conflict` is a name another role of the tenant already holds — compared
 * without case, so the two need not look alike on screen.
 */
const nameOverrides = async (
  locale: Locale
): Promise<RpcErrorMessageOverrides> => {
  const t = await getMessagesFor(locale);

  return {
    conflict: t("admin.creator_roles.name_taken"),
    "invalid-argument": t("admin.creator_roles.name_invalid", {
      count: String(CREATOR_ROLE_NAME_MAX_LENGTH),
    }),
  };
};

const mapErrorToMessage = (
  error: unknown,
  fallbackMessage: string,
  locale: Locale,
  overrides?: RpcErrorMessageOverrides
): string => rpcErrorMessage(error, fallbackMessage, { locale, overrides });

/** The generated `CreatorRole` fields {@link mapCreatorRole} reads. */
type RawCreatorRole = Pick<CreatorRole, "id" | "name" | "publicId">;

const mapCreatorRole = (creatorRole: RawCreatorRole): CreatorRoleItem => ({
  id: creatorRole.id ?? "",
  name: creatorRole.name ?? "",
  publicId: creatorRole.publicId ?? "",
});

/**
 * The cached body of {@link listCreatorRoles}, keyed on the tenant and locale it is given.
 *
 * Exported for a Server Action, which cannot read the `[tenant_id]` segment
 * and is given the tenant by the client: it calls `verifyAdminSession` with
 * that tenant first, because the service credential this reads with answers
 * for any tenant.
 */
export const listCreatorRolesForTenant = async (
  tenantId: string,
  locale: Locale
): Promise<ListCreatorRolesResult> => {
  "use cache";
  cacheTag(creatorRolesCacheTag(tenantId));

  const t = await getMessagesFor(locale);

  try {
    const creatorRoles: CreatorRoleItem[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.creatorRole.listCreatorRoles(
          {
            limit,
            tenant: { tenantId },
            token,
          },
          withServiceHeaders()
        );
        return {
          items: response.creatorRoles ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          creatorRoles.push(mapCreatorRole(item));
        }
      }
    );

    if (walkStop !== "completed") {
      dropFailedCacheEntry();
      return {
        creatorRoles: [],
        message: t("admin.creator_roles.list_failed"),
        ok: false,
      };
    }

    return { creatorRoles, ok: true };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    return {
      creatorRoles: [],
      message: await mapErrorToMessage(
        error,
        t("admin.creator_roles.list_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * Every creator role of the tenant, in the tenant's own priority order.
 *
 * The whole list rather than one page, because `ReorderCreatorRoles` compares
 * the order the client posts against the tenant's entire order and refuses a
 * mismatch: a screen holding one page could not name an order to send. Roles
 * are a hand-curated vocabulary, so the walk is a page or two in practice.
 *
 * An incomplete walk fails with an empty list rather than a partial one. A
 * partial list would not only hide roles — it would make every move button on
 * screen post an order that is missing rows, which the API refuses.
 */
export const listCreatorRoles = async (): Promise<ListCreatorRolesResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();
  return listCreatorRolesForTenant(tenantId, locale);
};

export const createCreatorRole = async (
  input: { tenantId: string; name: string },
  locale: Locale
): Promise<CreateCreatorRoleResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.creatorRole.createCreatorRole(
      {
        name: input.name,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creatorRole?.id?.trim()) {
      return { message: t("admin.creator_roles.save_failed"), ok: false };
    }

    return { creatorRole: mapCreatorRole(response.creatorRole), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.creator_roles.save_failed"),
        locale,
        await nameOverrides(locale)
      ),
      ok: false,
    };
  }
};

/**
 * Renames one role.
 *
 * The ID does not move, so every credit keeps the role it names: a
 * rename reaches the series form and the public site as new wording for the
 * credits that already exist.
 */
export const updateCreatorRole = async (
  input: { tenantId: string; id: string; name: string },
  locale: Locale
): Promise<UpdateCreatorRoleResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.creatorRole.updateCreatorRole(
      {
        creatorRoleId: input.id,
        name: input.name,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creatorRole?.id?.trim()) {
      return { message: t("admin.creator_roles.save_failed"), ok: false };
    }

    return { creatorRole: mapCreatorRole(response.creatorRole), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.creator_roles.save_failed"),
        locale,
        await nameOverrides(locale)
      ),
      ok: false,
    };
  }
};

/**
 * Writes the tenant's role priority.
 *
 * `expectedIds` is the order the screen was showing when the editor
 * pressed the button. The API locks the tenant's roles, re-reads their order,
 * and refuses with a failed precondition when it no longer matches — a console
 * left open while someone else added or moved a role therefore reports the
 * conflict instead of writing an order composed from a stale list.
 */
export const reorderCreatorRoles = async (
  input: {
    tenantId: string;
    ids: string[];
    expectedIds: string[];
  },
  locale: Locale
): Promise<ReorderCreatorRolesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.creatorRole.reorderCreatorRoles(
      {
        creatorRoleIds: input.ids,
        expectedCreatorRoleIds: input.expectedIds,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      creatorRoles: (response.creatorRoles ?? []).map((creatorRole) =>
        mapCreatorRole(creatorRole)
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.creator_roles.reorder_failed"),
        locale,
        {
          precondition: t("admin.creator_roles.reorder_conflict"),
        }
      ),
      ok: false,
    };
  }
};

/**
 * Removes a role no credit names.
 *
 * A role a series or an episode is still credited in comes back as a failed
 * precondition: the credits holding it would go with it, so the editor is told
 * to re-credit them first. How many those are travels as ErrorInfo metadata,
 * not in the server's English message, so the refusal is worded from the
 * catalog with the count interpolated.
 */
export const deleteCreatorRole = async (
  input: { tenantId: string; id: string },
  locale: Locale
): Promise<DeleteCreatorRoleResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.creatorRole.deleteCreatorRole(
      {
        creatorRoleId: input.id,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const creditCount = rpcErrorReasonMetadataNumber(
      error,
      RPC_ERROR_REASON.creatorRoleInUse,
      RPC_ERROR_METADATA.creditCount
    );
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.creator_roles.delete_failed"),
        locale,
        {
          precondition:
            creditCount === null
              ? t("admin.creator_roles.delete_in_use_unknown")
              : t("admin.creator_roles.delete_in_use", {
                  count: String(creditCount),
                }),
        }
      ),
      ok: false,
    };
  }
};
