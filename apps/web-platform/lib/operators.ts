import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type { PlatformOperator } from "@publira/api-client/platform/types";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import {
  SHARED_READ_CACHE_LIFE,
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
  withServiceHeaders,
} from "./api-client";
import { verifyPlatformSession } from "./auth-session";
import { rethrowUnauthenticatedRpcError } from "./auth-shared";
import { getPlatformLocale } from "./locale";
import { getMessagesFor } from "./messages";
import { normalizePlatformRole } from "./roles";

const getPlatformOperatorInputSchema = z.object({
  publicId: z.string().trim().min(1).max(255),
});

export interface PlatformOperatorSummary {
  createdAt: string;
  email: string;
  id: string;
  name: string;
  publicId: string;
  role: string;
  status: string;
}

export interface ListPlatformOperatorsInput {
  limit?: number;
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
    };

/**
 * The operator, or why they could not be read.
 *
 * `operator: null` is the missing record the caller turns into `notFound()`;
 * `ok: false` is a read that failed, which a 404 would misreport.
 */
export type GetPlatformOperatorResult =
  | { ok: true; operator: PlatformOperatorSummary | null }
  | { message: string; ok: false };

/**
 * The generated `PlatformOperator` fields {@link mapOperator} reads. Naming
 * them against the message type is what makes a proto rename fail here — a
 * restated structural type is a second copy of the message that goes on
 * compiling once the two drift.
 */
type RawPlatformOperator = Pick<
  PlatformOperator,
  "createdAt" | "email" | "id" | "name" | "publicId" | "role" | "status"
>;

const mapOperator = (
  operator: RawPlatformOperator
): PlatformOperatorSummary => ({
  createdAt: operator.createdAt,
  email: operator.email,
  id: operator.id,
  name: operator.name,
  publicId: operator.publicId,
  role: normalizePlatformRole(operator.role),
  status: operator.status,
});

/** The tag every operator read is filed under, and every operator write clears. */
export const platformOperatorsCacheTag = "platform:operators";

const listPlatformOperatorsForLocale = async (
  locale: Locale,
  limit: number,
  token: string
): Promise<ListPlatformOperatorsResult> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformOperatorsCacheTag);

  try {
    const response = await apiClient.operators.listOperators(
      { limit, token },
      withServiceHeaders()
    );
    return {
      nextToken: response.nextToken ?? "",
      ok: true,
      operators: (response.operators ?? []).map(mapOperator),
      previousToken: response.previousToken ?? "",
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the list comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      message: rpcErrorMessage(error, t("platform.operators.list_failed"), {
        locale,
      }),
      nextToken: "",
      ok: false,
      operators: [],
      previousToken: "",
    };
  }
};

/**
 * One page of the platform's operators.
 *
 * Read with the service credential: the list is the same for every operator,
 * so one entry serves all of them.
 */
export const listPlatformOperators = async (
  input: ListPlatformOperatorsInput = {}
): Promise<ListPlatformOperatorsResult> => {
  await verifyPlatformSession();
  return listPlatformOperatorsForLocale(
    await getPlatformLocale(),
    input.limit ?? 20,
    input.token ?? ""
  );
};

export const createPlatformOperator = async (
  input: CreatePlatformOperatorInput
): Promise<CreatePlatformOperatorResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    const t = await getMessagesFor(input.locale);
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.operators.createOperator(
      { email: input.email, name: input.name, role: input.role },
      buildSessionHeaders(sessionId)
    );
    return { ok: true, publicId: response.operator?.publicId };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const t = await getMessagesFor(input.locale);
    return {
      message: rpcErrorMessage(error, t("platform.common.generic_failed"), {
        locale: input.locale,
        overrides: {
          conflict: t("platform.operators.email_taken"),
        },
      }),
      ok: false,
    };
  }
};

export const suspendPlatformOperator = async (
  operatorId: string
): Promise<boolean> => {
  if (!operatorId.trim()) {
    return false;
  }
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return false;
  }
  try {
    await apiClient.operators.suspendOperator(
      { operatorId },
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
  operatorId: string
): Promise<boolean> => {
  if (!operatorId.trim()) {
    return false;
  }
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return false;
  }
  try {
    await apiClient.operators.unsuspendOperator(
      { operatorId },
      buildSessionHeaders(sessionId)
    );
    return true;
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

const getPlatformOperatorForLocale = async (
  locale: Locale,
  publicId: string
): Promise<GetPlatformOperatorResult> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformOperatorsCacheTag);

  try {
    const response = await apiClient.operators.getOperator(
      { publicId },
      withServiceHeaders()
    );
    return {
      ok: true,
      operator: response.operator ? mapOperator(response.operator) : null,
    };
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return { ok: true, operator: null };
    }
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the operator comes back as
    // soon as the API does.
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      message: rpcErrorMessage(error, t("platform.operators.get_failed"), {
        locale,
      }),
      ok: false,
    };
  }
};

/**
 * One operator, read with the service credential like
 * {@link listPlatformOperators}.
 */
export const getPlatformOperator = async (
  publicId: string
): Promise<GetPlatformOperatorResult> => {
  await verifyPlatformSession();

  const parsed = getPlatformOperatorInputSchema.safeParse({ publicId });
  if (!parsed.success) {
    // Same answer as a missing operator: the URL is not a resource, and
    // wording that said "malformed" would only help an attacker probe which
    // strings the server accepts.
    return { ok: true, operator: null };
  }

  return getPlatformOperatorForLocale(
    await getPlatformLocale(),
    parsed.data.publicId
  );
};

export interface UpdatePlatformOperatorRoleInput {
  locale: Locale;
  operatorId: string;
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
    const t = await getMessagesFor(input.locale);
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    await apiClient.operators.updateOperatorRole(
      { operatorId: input.operatorId, role: input.role },
      buildSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const t = await getMessagesFor(input.locale);
    return {
      message: rpcErrorMessage(error, t("platform.common.generic_failed"), {
        locale: input.locale,
      }),
      ok: false,
    };
  }
};

export const deactivatePlatformOperator = async (
  operatorId: string
): Promise<boolean> => {
  if (!operatorId.trim()) {
    return false;
  }
  const sid = await resolveAccessToken();
  try {
    await apiClient.operators.deactivateOperator(
      { operatorId },
      buildSessionHeaders(sid)
    );
    return true;
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};
