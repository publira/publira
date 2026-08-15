import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { z } from "zod";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
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
  token?: string;
}

export interface CreatePlatformOperatorInput {
  email: string;
  name: string;
  role: string;
}

export type CreatePlatformOperatorResult =
  | { ok: true; publicId?: string }
  | { ok: false; message: string };

const genericErrorMessage =
  "処理に失敗しました。時間をおいて再試行してください。";

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

const mapOperator = (operator: {
  createdAt: string;
  email: string;
  name: string;
  publicId: string;
  role: string;
  status: string;
}): PlatformOperatorSummary => ({
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
    return {
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      operators: [],
      previousToken: "",
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
    return {
      message: rpcErrorMessage(
        error,
        "オペレーター一覧の取得に失敗しました。時間をおいて再試行してください。"
      ),
      nextToken: "",
      ok: false,
      operators: [],
      previousToken: "",
    };
  }
};

export const createPlatformOperator = async (
  input: CreatePlatformOperatorInput
): Promise<CreatePlatformOperatorResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, genericErrorMessage, {
        conflict: "このメールアドレスはすでに登録されています。",
      }),
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
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

export const getPlatformOperator = async (
  publicId: string
): Promise<PlatformOperatorSummary | null> => {
  "use cache: private";

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
    return {
      message: "セッションが無効です。再ログインしてください。",
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
    rethrowUnclassifiedRpcError(error);
    return { message: rpcErrorMessage(error, genericErrorMessage), ok: false };
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
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};
