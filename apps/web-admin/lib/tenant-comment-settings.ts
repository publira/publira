import { CommentMode } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";
import type { TenantCommentMode } from "./tenant-comment-settings-shared";

/** What the tenant has decided about the comments its readers write. */
export interface TenantCommentSettings {
  commentMode: TenantCommentMode;
  /** Open reports that remove a comment; 0 leaves every removal to staff. */
  autoHideReportThreshold: number;
}

export type GetTenantCommentSettingsResult =
  | ({ ok: true } & TenantCommentSettings)
  | {
      ok: false;
      message: string;
      /**
       * No settings. A read that failed has no saved policy to report, and the
       * settings screen would otherwise offer to save values nobody chose over
       * the stored ones — turning commenting off for a tenant that had it on,
       * or removing comments at a threshold the tenant never picked.
       */
      requiresSignIn: boolean;
    };

export type UpdateTenantCommentSettingsResult =
  | ({ ok: true } & TenantCommentSettings)
  | { ok: false; message: string };

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved values visible in the same session instead of leaving
 * the previous ones in the private cache.
 */
export const tenantCommentSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:comment-settings`;

/**
 * `COMMENT_MODE_UNSPECIFIED` names no mode, so it resolves to nothing rather
 * than to `disabled`: a response that answered with the enum's zero value is a
 * read that failed to say anything, and reporting it as "commenting is off"
 * would put that in front of an operator as the tenant's own choice.
 */
const toTenantCommentMode = (
  mode: CommentMode | undefined
): TenantCommentMode | undefined => {
  switch (mode) {
    case CommentMode.DISABLED: {
      return "disabled";
    }
    case CommentMode.IMMEDIATE: {
      return "immediate";
    }
    case CommentMode.APPROVAL_REQUIRED: {
      return "approval_required";
    }
    default: {
      return undefined;
    }
  }
};

const toCommentModeEnum = (mode: TenantCommentMode): CommentMode => {
  switch (mode) {
    case "immediate": {
      return CommentMode.IMMEDIATE;
    }
    case "approval_required": {
      return CommentMode.APPROVAL_REQUIRED;
    }
    default: {
      return CommentMode.DISABLED;
    }
  }
};

export const getTenantCommentSettings = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantCommentSettingsResult> => {
  "use cache: private";

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(tenantCommentSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantCommentSettings(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    const commentMode = toTenantCommentMode(response.commentMode);
    if (commentMode === undefined) {
      return {
        message: t("admin.settings.comments.load_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }

    return {
      autoHideReportThreshold: response.autoHideReportThreshold,
      commentMode,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.comments.load_failed"),
        {
          locale,
        }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const updateTenantCommentSettings = async (
  input: {
    tenantId: string;
  } & TenantCommentSettings,
  locale: Locale
): Promise<UpdateTenantCommentSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantCommentSettings(
      {
        autoHideReportThreshold: input.autoHideReportThreshold,
        commentMode: toCommentModeEnum(input.commentMode),
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );
    const saved = toTenantCommentMode(response.commentMode);
    if (saved === undefined) {
      return { message: t("admin.settings.comments.save_failed"), ok: false };
    }

    return {
      autoHideReportThreshold: response.autoHideReportThreshold,
      commentMode: saved,
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.comments.save_failed"),
        {
          locale,
        }
      ),
      ok: false,
    };
  }
};
