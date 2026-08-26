import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { PlatformOperator } from "@publira/api-client/platform/types";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { getMessage } from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";
import { z } from "zod";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./auth-shared";
import { loadPlatformMessages } from "./locale";
import { normalizePlatformRole } from "./roles";

const getPlatformOperatorInputSchema = z.object({
  publicId: z.string().trim().min(1).max(255),
});

export interface PlatformOperatorSummary {
  createdAt: string;
  email: string;
  name: string;
  publicId: string;
  role: string;
  status: string;
}

export interface ListPlatformOperatorsInput {
  limit?: number;
  locale: Locale;
  token?: string;
}

export interface CreatePlatformOperatorInput {
  email: string;
  locale: Locale;
  name: string;
  role: string;
}

export type CreatePlatformOperatorResult =
  | { ok: true; publicId?: string }
  | { ok: false; message: string };

export type ListPlatformOperatorsResult =
  | {
      nextToken: string;
      ok: true;
      operators: PlatformOperatorSummary[];
      previousToken: string;
    }
  | {
      message: string;
      nextToken: string;
      ok: false;
      operators: PlatformOperatorSummary[];
      previousToken: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

/**
 * The generated `PlatformOperator` fields {@link mapOperator} reads. Naming
 * them against the message type is what makes a proto rename fail here — a
 * restated structural type is a second copy of the message that goes on
 * compiling once the two drift.
 */
type RawPlatformOperator = Pick<
  PlatformOperator,
  "createdAt" | "email" | "name" | "publicId" | "role" | "status"
>;

const mapOperator = (
  operator: RawPlatformOperator
): PlatformOperatorSummary => ({
  createdAt: operator.createdAt,
  email: operator.email,
  name: operator.name,
  publicId: operator.publicId,
  role: normalizePlatformRole(operator.role),
  status: operator.status,
});

export const listPlatformOperators = async (
  input: ListPlatformOperatorsInput
): Promise<ListPlatformOperatorsResult> => {
  "use cache: private";

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    dropFailedCacheEntry();
    const messages = await loadPlatformMessages(input.locale);
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      nextToken: "",
      ok: false,
      operators: [],
      previousToken: "",
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.operators.listOperators(
      {
        limit: input.limit ?? 20,
        token: input.token ?? "",
      },
      buildSessionHeaders(sessionId)
    );
    return {
      nextToken: response.nextToken ?? "",
      ok: true,
      operators: (response.operators ?? []).map(mapOperator),
      previousToken: response.previousToken ?? "",
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    // A failed read must not be cached: the client router would replay it after
    // the API recovers, and a cached `requiresSignIn` would bounce the operator
    // back to /login even once they have signed in again.
    dropFailedCacheEntry();
    const messages = await loadPlatformMessages(input.locale);
    return {
      message: rpcErrorMessage(
        error,
        getMessage(messages, "platform.operators.list_failed"),
        { locale: input.locale }
      ),
      nextToken: "",
      ok: false,
      operators: [],
      previousToken: "",
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const createPlatformOperator = async (
  input: CreatePlatformOperatorInput
): Promise<CreatePlatformOperatorResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    const messages = await loadPlatformMessages(input.locale);
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.operators.createOperator(
      { email: input.email, name: input.name, role: input.role } as never,
      buildSessionHeaders(sessionId)
    );
    return { ok: true, publicId: response.operator?.publicId };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const messages = await loadPlatformMessages(input.locale);
    return {
      message: rpcErrorMessage(
        error,
        getMessage(messages, "platform.common.generic_failed"),
        {
          locale: input.locale,
          overrides: {
            conflict: getMessage(messages, "platform.operators.email_taken"),
          },
        }
      ),
      ok: false,
    };
  }
};

export const suspendPlatformOperator = async (
  publicId: string
): Promise<boolean> => {
  if (!publicId.trim()) {
    return false;
  }
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return false;
  }
  try {
    await apiClient.operators.suspendOperator(
      { publicId } as never,
      buildSessionHeaders(sessionId)
    );
    return true;
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

export const unsuspendPlatformOperator = async (
  publicId: string
): Promise<boolean> => {
  if (!publicId.trim()) {
    return false;
  }
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return false;
  }
  try {
    await apiClient.operators.unsuspendOperator(
      { publicId } as never,
      buildSessionHeaders(sessionId)
    );
    return true;
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

export const getPlatformOperator = async (
  publicId: string,
  locale: Locale
): Promise<PlatformOperatorSummary | null> => {
  "use cache: private";

  // Locale is a cache-key argument so a later localized miss does not replay
  // under the wrong language. This read currently returns null on a miss.
  void locale;

  const parsed = getPlatformOperatorInputSchema.safeParse({ publicId });
  if (!parsed.success) {
    // Same null as a missing operator: the URL is not a resource, and
    // wording that said "malformed" would only help an attacker probe
    // which strings the server accepts.
    return null;
  }

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return null;
  }

  try {
    const response = await apiClient.operators.getOperator(
      { publicId: parsed.data.publicId },
      buildSessionHeaders(sessionId)
    );
    return response.operator ? mapOperator(response.operator) : null;
  } catch (error) {
    // Classified RPC failures mean "no operator to show"; unexpected ones rethrow.
    rethrowUnclassifiedRpcError(error);
    return null;
  }
};

export interface UpdatePlatformOperatorRoleInput {
  locale: Locale;
  publicId: string;
  role: string;
}

export type UpdatePlatformOperatorRoleResult =
  | { ok: true }
  | { ok: false; message: string };

export const updatePlatformOperatorRole = async (
  input: UpdatePlatformOperatorRoleInput
): Promise<UpdatePlatformOperatorRoleResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    const messages = await loadPlatformMessages(input.locale);
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    await apiClient.operators.updateOperatorRole(
      { publicId: input.publicId, role: input.role } as never,
      buildSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const messages = await loadPlatformMessages(input.locale);
    return {
      message: rpcErrorMessage(
        error,
        getMessage(messages, "platform.common.generic_failed"),
        { locale: input.locale }
      ),
      ok: false,
    };
  }
};

export const deactivatePlatformOperator = async (
  publicId: string
): Promise<boolean> => {
  if (!publicId.trim()) {
    return false;
  }
  const sid = await resolveAccessToken();
  try {
    await apiClient.operators.deactivateOperator(
      { publicId } as never,
      buildSessionHeaders(sid)
    );
    return true;
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};
