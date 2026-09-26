import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import type {
  PlatformStorageCheck,
  PlatformStorageSettings as RawPlatformStorageSettingsMessage,
} from "@publira/api-client/platform/types";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./auth-shared";
import type { PlatformMessageKey } from "./locale";
import { getMessagesFor } from "./messages";
import type { PlatformStorageSettings } from "./storage-settings-shared";

export type { PlatformStorageSettings } from "./storage-settings-shared";

/** What a save and a test both state: the values the form holds. */
export interface PlatformStorageInput {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  publicBaseUrl: string;
  region: string;
  secretAccessKey: string;
  secretAccessKeyUpdateMode: number;
}

export type GetPlatformStorageSettingsResult =
  | { ok: true; settings: PlatformStorageSettings }
  | { message: string; ok: false; requiresSignIn: boolean };

export type UpdatePlatformStorageSettingsResult =
  | { ok: true; settings: PlatformStorageSettings }
  | { message: string; ok: false };

/** One of the four operations, in the order the test performs them. */
export interface PlatformStorageCheckResult {
  label: string;
  /** Why it failed, or that it was not reached; empty when it succeeded. */
  detail: string;
  status: "failed" | "skipped" | "succeeded";
}

export type TestPlatformStorageConnectionResult =
  | { checks: PlatformStorageCheckResult[]; ok: true; succeeded: boolean }
  | { message: string; ok: false };

/** The tag the storage settings read is filed under, and their save clears. */
export const platformStorageSettingsCacheTag = "platform:storage-settings";

type RawPlatformStorageSettings = Pick<
  RawPlatformStorageSettingsMessage,
  | "accessKeyId"
  | "bucket"
  | "endpoint"
  | "forcePathStyle"
  | "hasSecretAccessKey"
  | "publicBaseUrl"
  | "region"
  | "revision"
>;

export const toPlatformStorageSettings = (
  settings?: RawPlatformStorageSettings
): PlatformStorageSettings => ({
  accessKeyId: settings?.accessKeyId ?? "",
  bucket: settings?.bucket ?? "",
  endpoint: settings?.endpoint ?? "",
  forcePathStyle: settings?.forcePathStyle ?? false,
  hasSecretAccessKey: settings?.hasSecretAccessKey ?? false,
  publicBaseUrl: settings?.publicBaseUrl ?? "",
  region: settings?.region ?? "",
  revision: String(settings?.revision ?? 0),
});

/**
 * The message for a `STORAGE_TEST_*` reason, which the connection test answers
 * with and the audit log records. Anything else is not a reason this console
 * knows, and answers `undefined`.
 */
export const storageTestFailureMessage = async (
  reason: string,
  locale: Locale
): Promise<string | undefined> => {
  const t = await getMessagesFor(locale);

  switch (reason) {
    case "STORAGE_TEST_BUCKET_NOT_FOUND": {
      return t("platform.storage.test.reasons.bucket_not_found");
    }
    case "STORAGE_TEST_CONNECTION": {
      return t("platform.storage.test.reasons.connection");
    }
    case "STORAGE_TEST_CREDENTIALS": {
      return t("platform.storage.test.reasons.credentials");
    }
    case "STORAGE_TEST_OBJECT_ALTERED": {
      return t("platform.storage.test.reasons.object_altered");
    }
    case "STORAGE_TEST_OBJECT_MISSING": {
      return t("platform.storage.test.reasons.object_missing");
    }
    case "STORAGE_TEST_PERMISSION": {
      return t("platform.storage.test.reasons.permission");
    }
    case "STORAGE_TEST_TIMEOUT": {
      return t("platform.storage.test.reasons.timeout");
    }
    case "STORAGE_TEST_UNKNOWN": {
      return t("platform.storage.test.reasons.unknown");
    }
    default: {
      return undefined;
    }
  }
};

/**
 * The generated enum numbers `PlatformStorageOperation`, listed in the order
 * the server performs them.
 */
const storageOperations = [1, 2, 3, 4] as const;

const toCheckResults = async (
  checks: Pick<PlatformStorageCheck, "operation" | "reason" | "succeeded">[],
  locale: Locale
): Promise<PlatformStorageCheckResult[]> => {
  const t = await getMessagesFor(locale);
  const operationLabel = (operation: (typeof storageOperations)[number]) => {
    switch (operation) {
      case 1: {
        return t("platform.storage.test.operations.put_object");
      }
      case 2: {
        return t("platform.storage.test.operations.get_object");
      }
      case 3: {
        return t("platform.storage.test.operations.list_objects");
      }
      case 4: {
        return t("platform.storage.test.operations.delete_object");
      }
      default: {
        return String(operation);
      }
    }
  };

  return await Promise.all(
    storageOperations.map(async (operation) => {
      const label = operationLabel(operation);
      const check = checks.find(
        (candidate) => candidate.operation === operation
      );
      if (!check) {
        return {
          detail: t("platform.storage.test.skipped"),
          label,
          status: "skipped" as const,
        };
      }
      if (check.succeeded) {
        return { detail: "", label, status: "succeeded" as const };
      }
      return {
        detail:
          (await storageTestFailureMessage(check.reason, locale)) ??
          t("platform.storage.test.reasons.unknown"),
        label,
        status: "failed" as const,
      };
    })
  );
};

/**
 * The server's validation text names the field it refused and nothing else —
 * never a credential — so it passes through as the actionable detail. Other
 * categories take the shared copy.
 */
const writeFailure = async (
  error: unknown,
  locale: Locale,
  fallbackKey: PlatformMessageKey
): Promise<{ message: string; ok: false }> => {
  rethrowUnauthenticatedRpcError(error);
  rethrowUnclassifiedRpcError(error);
  const t = await getMessagesFor(locale);
  const fallback = t(fallbackKey);
  return {
    message: rpcErrorMessage(error, fallback, {
      locale,
      overrides: {
        "invalid-argument": rpcErrorRawMessage(error)?.trim() || fallback,
        precondition: t("platform.storage.save_conflict"),
      },
    }),
    ok: false,
  };
};

export const getPlatformStorageSettings = async (
  locale: Locale
): Promise<GetPlatformStorageSettingsResult> => {
  "use cache: private";
  cacheTag(platformStorageSettingsCacheTag);

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.storageSettings.getPlatformStorageSettings(
      {},
      buildSessionHeaders(sessionId)
    );
    return { ok: true, settings: toPlatformStorageSettings(response.settings) };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    // A failed read must not be cached: the client router would replay it
    // after the API recovers.
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      message: rpcErrorMessage(error, t("platform.storage.load_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * Save the storage settings. `expectedRevision` is the revision the screen was
 * rendered at, so a save based on values another operator has since replaced
 * is refused instead of rolling their change back.
 */
export const updatePlatformStorageSettings = async (
  input: PlatformStorageInput,
  expectedRevision: bigint,
  locale: Locale
): Promise<UpdatePlatformStorageSettingsResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    const t = await getMessagesFor(locale);
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response =
      await apiClient.storageSettings.updatePlatformStorageSettings(
        { ...input, expectedRevision },
        buildSessionHeaders(sessionId)
      );
    return { ok: true, settings: toPlatformStorageSettings(response.settings) };
  } catch (error) {
    return writeFailure(error, locale, "platform.storage.save_failed");
  }
};

export const testPlatformStorageConnection = async (
  input: PlatformStorageInput,
  locale: Locale
): Promise<TestPlatformStorageConnectionResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    const t = await getMessagesFor(locale);
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response =
      await apiClient.storageSettings.testPlatformStorageConnection(
        input,
        buildSessionHeaders(sessionId)
      );
    return {
      checks: await toCheckResults(response.checks, locale),
      ok: true,
      succeeded:
        response.checks.length === storageOperations.length &&
        response.checks.every((check) => check.succeeded),
    };
  } catch (error) {
    return writeFailure(error, locale, "platform.storage.test.failed");
  }
};
