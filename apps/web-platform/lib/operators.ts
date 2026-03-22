import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";

export interface PlatformOperatorSummary {
  createdAt: string;
  email: string;
  name: string;
  publicId: string;
  role: string;
  status: string;
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

export const listPlatformOperators = async (): Promise<
  PlatformOperatorSummary[]
> => {
  const sessionId = await resolveSessionId();
  if (!sessionId) {
    return [];
  }

  try {
    const response = await apiClient.operators.listOperators(
      {},
      buildSessionHeaders(sessionId)
    );
    return (response.operators ?? []).map((operator) => ({
      createdAt: operator.createdAt,
      email: operator.email,
      name: operator.name,
      publicId: operator.publicId,
      role: operator.role,
      status: operator.status,
    }));
  } catch {
    return [];
  }
};

export const createPlatformOperator = async (
  input: CreatePlatformOperatorInput
): Promise<CreatePlatformOperatorResult> => {
  const sessionId = await resolveSessionId();
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
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("already_exists") || msg.includes("already exists")) {
        return {
          message: "このメールアドレスはすでに登録されています。",
          ok: false,
        };
      }
    }
    return { message: genericErrorMessage, ok: false };
  }
};

export const suspendPlatformOperator = async (
  publicId: string
): Promise<boolean> => {
  if (!publicId.trim()) {
    return false;
  }
  const sessionId = await resolveSessionId();
  if (!sessionId) {
    return false;
  }
  try {
    await apiClient.operators.suspendOperator(
      { publicId } as never,
      buildSessionHeaders(sessionId)
    );
    return true;
  } catch {
    return false;
  }
};

export const unsuspendPlatformOperator = async (
  publicId: string
): Promise<boolean> => {
  if (!publicId.trim()) {
    return false;
  }
  const sessionId = await resolveSessionId();
  if (!sessionId) {
    return false;
  }
  try {
    await apiClient.operators.unsuspendOperator(
      { publicId } as never,
      buildSessionHeaders(sessionId)
    );
    return true;
  } catch {
    return false;
  }
};

export const getPlatformOperator = async (
  publicId: string
): Promise<PlatformOperatorSummary | null> => {
  if (!publicId.trim()) {
    return null;
  }
  try {
    const operators = await listPlatformOperators();
    return operators.find((op) => op.publicId === publicId) ?? null;
  } catch {
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
  const sessionId = await resolveSessionId();
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
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("permission_denied") || msg.includes("forbidden")) {
        return {
          message: "この操作を行う権限がありません。",
          ok: false,
        };
      }
    }
    return { message: genericErrorMessage, ok: false };
  }
};

export const deactivatePlatformOperator = async (
  publicId: string
): Promise<boolean> => {
  if (!publicId.trim()) {
    return false;
  }
  const sid = await resolveSessionId();
  try {
    await apiClient.operators.deactivateOperator(
      { publicId } as never,
      buildSessionHeaders(sid)
    );
    return true;
  } catch {
    return false;
  }
};
