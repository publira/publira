import { apiClient } from "./api-client";

const isExpectedNullableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("not_found") ||
    message.includes("not found") ||
    message.includes("failed_precondition")
  );
};

export const isSetupCompleted = async (): Promise<boolean | null> => {
  "use cache: private";

  try {
    const response = await apiClient.setup.checkSetupStatus({});
    return response.setupCompleted;
  } catch (error) {
    if (isExpectedNullableError(error)) {
      return null;
    }
    throw error;
  }
};

export type SetupResult = { ok: true } | { ok: false; message: string };

const genericErrorMessage =
  "セットアップに失敗しました。時間をおいて再試行してください。";

export const createInitialUser = async (
  name: string,
  email: string,
  password: string
): Promise<SetupResult> => {
  try {
    await apiClient.setup.createInitialUser({ email, name, password });
    return { ok: true };
  } catch (error) {
    if (!(error instanceof Error)) {
      return { message: genericErrorMessage, ok: false };
    }

    const message = error.message.toLowerCase();
    if (
      message.includes("already_exists") ||
      message.includes("already completed")
    ) {
      return {
        message:
          "セットアップは既に完了しています。ログイン画面からサインインしてください。",
        ok: false,
      };
    }
    if (
      message.includes("invalid_argument") ||
      message.includes("required") ||
      message.includes("invalid email")
    ) {
      return { message: "入力内容に誤りがあります。", ok: false };
    }

    return { message: genericErrorMessage, ok: false };
  }
};
