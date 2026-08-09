import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";

import { apiClient } from "./api-client";

/**
 * Setup status is unknown rather than failed when the platform has not been
 * initialized yet: the RPC answers `not_found` before the first tenant exists
 * and `failed_precondition` while bootstrap is still running.
 */
const isSetupStatusUnknownError = (error: unknown): boolean =>
  isRpcError(error, Code.NotFound, Code.FailedPrecondition);

export const isSetupCompleted = async (): Promise<boolean | null> => {
  "use cache: private";

  try {
    const response = await apiClient.setup.checkSetupStatus({});
    return response.setupCompleted;
  } catch (error) {
    if (isSetupStatusUnknownError(error)) {
      return null;
    }
    throw error;
  }
};

export type SetupResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      /** Setup already ran; the caller sends the operator to login instead. */
      alreadyCompleted: boolean;
    };

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
    rethrowUnclassifiedRpcError(error);
    return {
      // `already_exists` is only ever raised here for "setup already completed"
      // (`server/api/platformapi/setup_handlers.go`).
      alreadyCompleted: rpcErrorDisposition(error) === "conflict",
      message: rpcErrorMessage(error, genericErrorMessage, {
        conflict:
          "セットアップは既に完了しています。ログイン画面からサインインしてください。",
      }),
      ok: false,
    };
  }
};
