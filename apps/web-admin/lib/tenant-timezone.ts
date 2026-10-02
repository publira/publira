import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { DEFAULT_TIME_ZONE } from "@publira/utils";

import { rethrowUnauthenticatedRpcError } from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import { getTenantPublicInfo } from "./public-api";
import { getAccessToken } from "./session";

export type GetTenantTimezoneResult =
  | { ok: true; timezone: string }
  | { ok: false; message: string; timezone: string };

export type UpdateTenantTimezoneResult =
  | { ok: true; timezone: string }
  | { ok: false; message: string };

/**
 * The server rejects an unknown IANA name with `invalid_argument` and names the
 * field ("timezone must be a valid IANA time zone name"), which is more useful
 * to the operator than the generic wording. Everything else takes the shared copy.
 */
const parseErrorMessage = (
  error: unknown,
  fallback: string,
  locale: Locale
): string => {
  const serverMessage = rpcErrorRawMessage(error)?.trim() || fallback;
  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: { "invalid-argument": serverMessage },
  });
};

/**
 * The saved zone, for the settings screen that edits it.
 *
 * Read from the public `GetTenant`, which answers the same resolved zone as the
 * admin API's `GetTenantTimezone` to everyone, so the entry is shared by every
 * operator of the tenant and filed under `tenant:<id>:site`.
 */
export const getTenantTimezone = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantTimezoneResult> => {
  const info = await getTenantPublicInfo(tenantId);
  if (info?.timezone) {
    return { ok: true, timezone: info.timezone };
  }

  const t = await getMessagesFor(locale);
  return {
    message: t("admin.settings.timezone.load_failed"),
    ok: false,
    timezone: DEFAULT_TIME_ZONE,
  };
};

/**
 * Display / conversion zone for every date the admin console shows or accepts.
 * One entry point, so a screen never falls back to the fixed
 * `DEFAULT_TIME_ZONE` by omission and the console agrees with the public site
 * about what the tenant's wall clock is.
 *
 * An unavailable tenant read degrades to {@link DEFAULT_TIME_ZONE} rather than
 * to the host's zone, so the rendered wall clock never depends on where the
 * container runs. The read is the public `GetTenant`, tagged
 * `tenant:<id>:site`, which saving the zone clears, so a change reaches every
 * screen.
 */
export const getTenantDisplayTimeZone = async (
  tenantId: string
): Promise<string> => {
  const info = await getTenantPublicInfo(tenantId);
  return info?.timezone ?? DEFAULT_TIME_ZONE;
};

export const updateTenantTimezone = async (
  input: {
    tenantId: string;
    timezone: string;
  },
  locale: Locale
): Promise<UpdateTenantTimezoneResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantTimezone(
      {
        tenant: { tenantId: normalizedTenantId },
        timezone: input.timezone,
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      timezone: response.timezone.trim() || DEFAULT_TIME_ZONE,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(
        error,
        t("admin.settings.timezone.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};
