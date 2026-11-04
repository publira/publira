import type { TenantTaxSettings as RpcTenantTaxSettings } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  rethrowUnclassifiedRpcError,
  rpcErrorCode,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

/**
 * What the tenant states about the tax its prices include, and what its
 * receipts and royalty statements name. Rates are in basis points, 1000 for
 * 10%, and `null` where none is set.
 */
export interface TenantTaxSettings {
  taxRateBps: number | null;
  /**
   * RFC 3339: when the rate in effect was saved, which is when it started to
   * apply. Empty while the tenant has never set one.
   */
  taxRateAppliesFrom: string;
  withholdingRateBps: number | null;
  /** Empty where none is entered. */
  invoiceLegalName: string;
  /** Empty where none is entered. */
  invoiceRegistrationNumber: string;
}

/** What a save writes: every field, `applies_from` being the server's. */
export type TenantTaxSettingsInput = Omit<
  TenantTaxSettings,
  "taxRateAppliesFrom"
>;

export type TenantTaxSettingsResult =
  | { ok: true; settings: TenantTaxSettings }
  | {
      ok: false;
      message: string;
      /** Set by the read only; the update path throws instead. */
      requiresSignIn?: boolean;
    };

/** Refusals worded for the field each belongs to. */
export type TenantTaxSettingsFieldErrors = Partial<
  Record<keyof TenantTaxSettingsInput, string>
>;

export type UpdateTenantTaxSettingsResult =
  | { ok: true; settings: TenantTaxSettings }
  | {
      ok: false;
      message: string;
      fieldErrors?: TenantTaxSettingsFieldErrors;
    };

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved settings visible in the same session instead of
 * leaving the previous ones in the private cache.
 */
export const tenantTaxSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:tax-settings`;

type RawTenantTaxSettings = Pick<
  RpcTenantTaxSettings,
  | "invoiceLegalName"
  | "invoiceRegistrationNumber"
  | "taxRate"
  | "withholdingRateBps"
>;

const toTenantTaxSettings = (
  settings?: RawTenantTaxSettings
): TenantTaxSettings => ({
  invoiceLegalName: settings?.invoiceLegalName ?? "",
  invoiceRegistrationNumber: settings?.invoiceRegistrationNumber ?? "",
  taxRateAppliesFrom: settings?.taxRate?.appliesFrom ?? "",
  taxRateBps: settings?.taxRate?.rateBps ?? null,
  withholdingRateBps: settings?.withholdingRateBps ?? null,
});

const getTenantTaxSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<TenantTaxSettingsResult>> => {
  "use cache: private";

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();

    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(tenantTaxSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantTaxSettings(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true, settings: toTenantTaxSettings(response.settings) };
  } catch (error) {
    dropFailedCacheEntry();

    // The previous release's server has no such RPC, and an install may run
    // it beside this console while it upgrades. That costs this card alone,
    // closed as for any read that failed, rather than the settings page.
    if (rpcErrorCode(error) === Code.Unimplemented) {
      return { message: t("admin.settings.tax.load_failed"), ok: false };
    }

    return {
      message: rpcErrorMessage(error, t("admin.settings.tax.load_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** Every member of staff reads the settings; a tenant admin alone saves them. */
export const getTenantTaxSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantTaxSettingsResult> =>
  settleCachedRead(
    await getTenantTaxSettingsForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

/** The API's field paths, by the field of the card each names. */
const REFUSABLE_FIELDS = [
  ["taxRateBps", "tax_rate_bps"],
  ["withholdingRateBps", "withholding_rate_bps"],
  ["invoiceLegalName", "invoice_legal_name"],
  ["invoiceRegistrationNumber", "invoice_registration_number"],
] as const satisfies readonly (readonly [
  keyof TenantTaxSettingsInput,
  string,
])[];

/**
 * Which field the API refused. The Action reads each one by the server's rule
 * first, so a refused field is one the two rules read differently; the
 * server's answer is the one that stands.
 */
const refusedField = (
  cause: unknown
): keyof TenantTaxSettingsInput | undefined =>
  REFUSABLE_FIELDS.find(([, path]) =>
    rpcErrorHasFieldViolation(cause, path)
  )?.[0];

/** Writes every field; an empty one clears it, and an unset rate sets none. */
export const updateTenantTaxSettings = async (
  input: { tenantId: string } & TenantTaxSettingsInput,
  locale: Locale
): Promise<UpdateTenantTaxSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantTaxSettings(
      {
        invoiceLegalName: input.invoiceLegalName,
        invoiceRegistrationNumber: input.invoiceRegistrationNumber,
        taxRateBps: input.taxRateBps ?? undefined,
        tenant: { tenantId: normalizedTenantId },
        withholdingRateBps: input.withholdingRateBps ?? undefined,
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true, settings: toTenantTaxSettings(response.settings) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const refused = refusedField(error);

    if (refused) {
      const message = t("admin.settings.tax.validation.refused");

      return { fieldErrors: { [refused]: message }, message, ok: false };
    }

    return {
      message: rpcErrorMessage(error, t("admin.settings.tax.save_failed"), {
        locale,
      }),
      ok: false,
    };
  }
};
