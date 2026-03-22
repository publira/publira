import { platformApiClient } from "./platform-api-client";

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
  sessionId: string;
}

export type CreatePlatformOperatorResult =
  | { ok: true; publicId?: string }
  | { ok: false; message: string };

const genericErrorMessage =
  "処理に失敗しました。時間をおいて再試行してください。";

const buildHeaders = (sessionId: string) =>
  ({ headers: { "X-Publira-Session-Id": sessionId } }) as never;

export const listPlatformOperators = async (
  sessionId: string
): Promise<PlatformOperatorSummary[]> => {
  if (!sessionId.trim()) {
    return [];
  }

  try {
    const response = await platformApiClient.operators.listOperators(
      {},
      buildHeaders(sessionId)
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
  const sessionId = input.sessionId.trim();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await platformApiClient.operators.createOperator(
      { email: input.email, name: input.name, role: input.role } as never,
      buildHeaders(sessionId)
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
  publicId: string,
  sessionId: string
): Promise<boolean> => {
  if (!publicId.trim() || !sessionId.trim()) {
    return false;
  }
  try {
    await platformApiClient.operators.suspendOperator(
      { publicId } as never,
      buildHeaders(sessionId)
    );
    return true;
  } catch {
    return false;
  }
};

export const unsuspendPlatformOperator = async (
  publicId: string,
  sessionId: string
): Promise<boolean> => {
  if (!publicId.trim() || !sessionId.trim()) {
    return false;
  }
  try {
    await platformApiClient.operators.unsuspendOperator(
      { publicId } as never,
      buildHeaders(sessionId)
    );
    return true;
  } catch {
    return false;
  }
};
