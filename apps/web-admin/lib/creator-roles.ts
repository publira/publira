import type { CreatorRole } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { RpcErrorMessageOverrides } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
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
import { CREATOR_ROLE_NAME_MAX_LENGTH } from "./creator-roles-shared";
import { getAccessToken } from "./session";

export interface CreatorRoleItem {
  publicId: string;
  name: string;
}

export type ListCreatorRolesResult =
  | { ok: true; creatorRoles: CreatorRoleItem[] }
  | {
      ok: false;
      message: string;
      creatorRoles: CreatorRoleItem[];
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
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

const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");
const listErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.creator_roles.list_failed");
const saveErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.creator_roles.save_failed");

/**
 * The name rules the API enforces, worded once for both writes that carry a
 * name. `invalid-argument` is an empty name or one past the bound, and
 * `conflict` is a name another role of the tenant already holds — compared
 * without case, so the two need not look alike on screen.
 */
const nameOverrides = (messages: SharedMessages): RpcErrorMessageOverrides => ({
  conflict: getMessage(messages, "admin.creator_roles.name_taken"),
  "invalid-argument": getMessage(messages, "admin.creator_roles.name_invalid", {
    count: String(CREATOR_ROLE_NAME_MAX_LENGTH),
  }),
});

const mapErrorToMessage = (
  error: unknown,
  fallbackMessage: string,
  locale: Locale,
  overrides?: RpcErrorMessageOverrides
): string => rpcErrorMessage(error, fallbackMessage, { locale, overrides });

/** The generated `CreatorRole` fields {@link mapCreatorRole} reads. */
type RawCreatorRole = Pick<CreatorRole, "name" | "publicId">;

const mapCreatorRole = (creatorRole: RawCreatorRole): CreatorRoleItem => ({
  name: creatorRole.name ?? "",
  publicId: creatorRole.publicId ?? "",
});

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
export const listCreatorRoles = async (
  tenantId: string,
  locale: Locale
): Promise<ListCreatorRolesResult> => {
  "use cache: private";
  cacheTag(creatorRolesCacheTag(tenantId));

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      creatorRoles: [],
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
    };
  }

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
          withSessionHeaders(sessionId)
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
      return {
        creatorRoles: [],
        message: listErrorMessage(messages),
        ok: false,
        requiresSignIn: false,
      };
    }

    return { creatorRoles, ok: true };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      creatorRoles: [],
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * The role at the top of the tenant's priority order, by public ID.
 *
 * The series form has no role control yet, so every creator it saves is
 * credited in this one — which is what a series credited to one person means.
 * [#1936](https://github.com/publira/publira/issues/1936) puts a select on each
 * creator row and this stops being the only answer.
 *
 * A tenant always has roles: tenant creation gives it the starting vocabulary,
 * and the console cannot delete a role a credit names. An empty list is
 * therefore a broken tenant rather than a state to paper over, so it throws.
 */
export const getLeadingCreatorRolePublicId = async (
  tenantId: string,
  sessionId: string
): Promise<string> => {
  const response = await apiClient.creatorRole.listCreatorRoles(
    { limit: 1, tenant: { tenantId } },
    withSessionHeaders(sessionId)
  );
  const publicId = response.creatorRoles.at(0)?.publicId?.trim();
  if (!publicId) {
    throw new Error(`tenant ${tenantId} has no creator roles`);
  }
  return publicId;
};

export const createCreatorRole = async (
  input: { tenantId: string; name: string },
  locale: Locale
): Promise<CreateCreatorRoleResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
  }

  try {
    const response = await apiClient.creatorRole.createCreatorRole(
      {
        name: input.name,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creatorRole?.publicId?.trim()) {
      return { message: saveErrorMessage(messages), ok: false };
    }

    return { creatorRole: mapCreatorRole(response.creatorRole), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(
        error,
        saveErrorMessage(messages),
        locale,
        nameOverrides(messages)
      ),
      ok: false,
    };
  }
};

/**
 * Renames one role.
 *
 * The public ID does not move, so every credit keeps the role it names: a
 * rename reaches the series form and the public site as new wording for the
 * credits that already exist.
 */
export const updateCreatorRole = async (
  input: { tenantId: string; publicId: string; name: string },
  locale: Locale
): Promise<UpdateCreatorRoleResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
  }

  try {
    const response = await apiClient.creatorRole.updateCreatorRole(
      {
        name: input.name,
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creatorRole?.publicId?.trim()) {
      return { message: saveErrorMessage(messages), ok: false };
    }

    return { creatorRole: mapCreatorRole(response.creatorRole), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(
        error,
        saveErrorMessage(messages),
        locale,
        nameOverrides(messages)
      ),
      ok: false,
    };
  }
};

/**
 * Writes the tenant's role priority.
 *
 * `expectedPublicIds` is the order the screen was showing when the editor
 * pressed the button. The API locks the tenant's roles, re-reads their order,
 * and refuses with a failed precondition when it no longer matches — a console
 * left open while someone else added or moved a role therefore reports the
 * conflict instead of writing an order composed from a stale list.
 */
export const reorderCreatorRoles = async (
  input: {
    tenantId: string;
    publicIds: string[];
    expectedPublicIds: string[];
  },
  locale: Locale
): Promise<ReorderCreatorRolesResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
  }

  try {
    const response = await apiClient.creatorRole.reorderCreatorRoles(
      {
        creatorRolePublicIds: input.publicIds,
        expectedCreatorRolePublicIds: input.expectedPublicIds,
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
      message: mapErrorToMessage(
        error,
        getMessage(messages, "admin.creator_roles.reorder_failed"),
        locale,
        {
          precondition: getMessage(
            messages,
            "admin.creator_roles.reorder_conflict"
          ),
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
 * to re-credit them first. How many those are is in the server's own message,
 * which is untranslated and therefore never rendered, so the refusal is worded
 * from the catalog instead.
 */
export const deleteCreatorRole = async (
  input: { tenantId: string; publicId: string },
  locale: Locale
): Promise<DeleteCreatorRoleResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
  }

  try {
    await apiClient.creatorRole.deleteCreatorRole(
      {
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
      message: mapErrorToMessage(
        error,
        getMessage(messages, "admin.creator_roles.delete_failed"),
        locale,
        {
          precondition: getMessage(
            messages,
            "admin.creator_roles.delete_in_use"
          ),
        }
      ),
      ok: false,
    };
  }
};
