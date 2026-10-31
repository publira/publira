import type { GetTenantCoinSettingsResponse } from "@publira/api-client/admin/coin";
import type {
  CoinPack as RpcCoinPack,
  CoinNameTranslation as RpcCoinNameTranslation,
  TenantCoinSettings as RpcTenantCoinSettings,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  RPC_ERROR_METADATA,
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
  rpcErrorReasonMetadataNumber,
} from "@publira/api-client/errors";
import { getLocaleLabel, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { getMessagesFor } from "./messages";
import type { AdminMessageAccessor } from "./messages";
import { readCurrency } from "./price";
import { getAccessToken } from "./session";

/** One language's word for the tenant's coins. */
export interface CoinName {
  locale: Locale;
  name: string;
}

/**
 * The tenant's coins as the console edits them. Amounts are in the minor unit
 * of the tenant currency, and a zero `coinUnitAmount` or `expiryDays` is one
 * the tenant has not stated yet.
 */
export interface CoinSettings {
  enabled: boolean;
  selling: boolean;
  coinUnitAmount: number;
  expiryDays: number;
  issuerName: string;
  termsUrl: string;
  contact: string;
  notice: string;
  names: CoinName[];
}

/**
 * The settings, whether the platform lets tenants issue coins at all, and the
 * currency every amount is in, `null` while it cannot be read.
 */
export interface CoinSettingsRead {
  settings: CoinSettings;
  platformAllowsCoins: boolean;
  currency: string | null;
}

export interface CoinPackItem {
  /** The primary key every pack write addresses the pack by. */
  id: string;
  coins: number;
  bonusCoins: number;
  /** In the minor unit of {@link currency}. */
  price: number;
  currency: string;
  sortOrder: number;
  onSale: boolean;
  /** Whether a reader has bought it, which fixes its coins and price. */
  sold: boolean;
}

/** The fields a pack is saved with, the order it is listed in included. */
export interface CoinPackInput {
  coins: number;
  bonusCoins: number;
  price: number;
  sortOrder: number;
  onSale: boolean;
  /** The currency `price` was read in, or empty to write it unchecked. */
  currency: string;
}

/**
 * Where a coin settings save was refused, keyed by the field the form
 * reports it under: a name under `name.<locale>`.
 */
export type CoinSettingsFieldErrors = Partial<Record<string, string>>;

export type CoinSettingsResult =
  | ({ ok: true } & CoinSettingsRead)
  | {
      ok: false;
      message: string;
      fieldErrors?: CoinSettingsFieldErrors;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn?: boolean;
    };

export type ListCoinPacksResult =
  | { ok: true; packs: CoinPackItem[] }
  | {
      ok: false;
      message: string;
      packs: CoinPackItem[];
      requiresSignIn?: boolean;
    };

export type SaveCoinPackResult =
  | { ok: true; pack: CoinPackItem }
  | { ok: false; message: string };

export type RetireCoinPackResult =
  | { ok: true }
  | { ok: false; message: string };

/** Which of the states the console names the tenant's coins are in. */
export type CoinStatus = "not_selling" | "off" | "selling";

/** The most packs the API lets a tenant hold. */
export const COIN_PACK_LIMIT = 20;

/** The longest name the API takes, in code points. */
export const COIN_NAME_MAX_LENGTH = 30;

/** The longest expiry the API takes, in days. */
export const COIN_EXPIRY_DAYS_MAX = 36_500;

/** The longest disclosures the API takes, in code points. */
export const COIN_ISSUER_NAME_MAX_LENGTH = 200;
export const COIN_CONTACT_MAX_LENGTH = 500;
export const COIN_NOTICE_MAX_LENGTH = 2000;
export const COIN_TERMS_URL_MAX_LENGTH = 2048;

/**
 * The tag the coin screen's reads carry — the settings, the packs, and the
 * navigation entry that asks whether the platform allows coins — so every
 * coin write reaches all of them in the same session. The storefront's copies
 * are dropped by the API as the write lands.
 */
export const coinsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:coins`;

/**
 * The field one language's name posts as, which a refusal of that name is
 * reported under too.
 */
export const coinNameField = (locale: Locale): string => `name.${locale}`;

export const coinStatus = (
  settings: Pick<CoinSettings, "enabled" | "selling">
): CoinStatus => {
  if (!settings.enabled) {
    return "off";
  }

  return settings.selling ? "selling" : "not_selling";
};

/**
 * The tenant's word for its coins as `locale` reads it, falling back to the
 * default locale's as a reader's screen does, or `undefined` before the
 * tenant has named them.
 */
export const coinNameFor = (
  names: readonly CoinName[],
  locale: Locale,
  defaultLocale: Locale | undefined
): string | undefined =>
  (
    names.find((name) => name.locale === locale) ??
    names.find((name) => name.locale === defaultLocale)
  )?.name;

type RawCoinNameTranslation = Pick<RpcCoinNameTranslation, "locale" | "name">;

type RawTenantCoinSettings = Pick<
  RpcTenantCoinSettings,
  | "coinUnitAmount"
  | "contact"
  | "enabled"
  | "expiryDays"
  | "issuerName"
  | "notice"
  | "selling"
  | "termsUrl"
> & { names: RawCoinNameTranslation[] };

/**
 * The fields of a coin settings read or save {@link toCoinSettingsRead} reads.
 * `UpdateTenantCoinSettings` answers the same three as
 * `GetTenantCoinSettings`, so one key list names both.
 */
type RawCoinSettingsResponse = Pick<
  GetTenantCoinSettingsResponse,
  "currency" | "platformAllowsCoins"
> & { settings?: RawTenantCoinSettings };

type RawCoinPack = Pick<
  RpcCoinPack,
  | "bonusCoins"
  | "coins"
  | "currency"
  | "id"
  | "onSale"
  | "price"
  | "sold"
  | "sortOrder"
>;

/**
 * A name in a language this build serves no catalog for has no field to show
 * it in, so it is left out, as a series translation is.
 */
const toCoinNames = (
  names: readonly RawCoinNameTranslation[] | undefined
): CoinName[] =>
  (names ?? []).flatMap((name) => {
    const locale = parseLocale(name.locale?.trim());

    return locale ? [{ locale, name: name.name ?? "" }] : [];
  });

const toCoinSettings = (
  settings: RawTenantCoinSettings | undefined
): CoinSettings => ({
  coinUnitAmount: settings?.coinUnitAmount ?? 0,
  contact: settings?.contact ?? "",
  enabled: Boolean(settings?.enabled),
  expiryDays: settings?.expiryDays ?? 0,
  issuerName: settings?.issuerName ?? "",
  names: toCoinNames(settings?.names),
  notice: settings?.notice ?? "",
  selling: Boolean(settings?.selling),
  termsUrl: settings?.termsUrl ?? "",
});

const toCoinSettingsRead = (
  response: RawCoinSettingsResponse
): CoinSettingsRead => ({
  currency: readCurrency(response.currency),
  platformAllowsCoins: Boolean(response.platformAllowsCoins),
  settings: toCoinSettings(response.settings),
});

const toCoinPack = (pack: RawCoinPack): CoinPackItem => ({
  bonusCoins: pack.bonusCoins ?? 0,
  coins: pack.coins ?? 0,
  currency: pack.currency ?? "",
  id: pack.id ?? "",
  onSale: Boolean(pack.onSale),
  price: pack.price ?? 0,
  sold: Boolean(pack.sold),
  sortOrder: pack.sortOrder ?? 0,
});

const getCoinSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<CoinSettingsResult>> => {
  "use cache: private";
  // Whether the platform allows tenant coins is the Platform Console's to
  // change, and nothing in this app clears this tag when it does, so the entry
  // is refetched once it is a minute old.
  cacheLife("minutes");

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

  cacheTag(coinsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.coins.getTenantCoinSettings(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true, ...toCoinSettingsRead(response) };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(error, t("admin.coins.load_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const getCoinSettings = async (
  tenantId: string,
  locale: Locale
): Promise<CoinSettingsResult> =>
  settleCachedRead(
    await getCoinSettingsForSession(tenantId, locale, await getAccessToken())
  );

const listCoinPacksForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<ListCoinPacksResult>> => {
  "use cache: private";

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();

    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      packs: [],
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(coinsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.coins.listCoinPacks(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true, packs: (response.packs ?? []).map(toCoinPack) };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(error, t("admin.coins.packs.list_failed"), {
        locale,
      }),
      ok: false,
      packs: [],
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const listCoinPacks = async (
  tenantId: string,
  locale: Locale
): Promise<ListCoinPacksResult> =>
  settleCachedRead(
    await listCoinPacksForSession(tenantId, locale, await getAccessToken())
  );

/**
 * The fields the API named in a refused save, under the keys the form reports
 * them by. Only the server's checks are authoritative, so a value the form
 * passed can still come back here.
 */
const refusedSettingsFieldErrors = (
  cause: unknown,
  names: readonly CoinName[],
  defaultLocale: Locale,
  t: AdminMessageAccessor
): CoinSettingsFieldErrors | undefined => {
  const fieldErrors: CoinSettingsFieldErrors = {};

  const fields = [
    [
      "coin_unit_amount",
      "coinUnitAmount",
      "admin.coins.settings.validation.unit_amount_invalid",
    ],
    [
      "expiry_days",
      "expiryDays",
      "admin.coins.settings.validation.expiry_days_invalid",
    ],
    [
      "issuer_name",
      "issuerName",
      "admin.coins.settings.validation.issuer_name_invalid",
    ],
    [
      "terms_url",
      "termsUrl",
      "admin.coins.settings.validation.terms_url_invalid",
    ],
    ["contact", "contact", "admin.coins.settings.validation.contact_invalid"],
    ["notice", "notice", "admin.coins.settings.validation.notice_invalid"],
  ] as const;

  for (const [field, key, message] of fields) {
    if (rpcErrorHasFieldViolation(cause, `settings.${field}`)) {
      fieldErrors[key] = t(message);
    }
  }

  for (const [index, name] of names.entries()) {
    if (
      rpcErrorHasFieldViolation(cause, `settings.names[${index}].name`) ||
      rpcErrorHasFieldViolation(cause, `settings.names[${index}].locale`)
    ) {
      fieldErrors[coinNameField(name.locale)] = t(
        "admin.coins.settings.validation.name_invalid",
        { count: COIN_NAME_MAX_LENGTH }
      );
    }
  }

  // A name missing in the default locale while coins are being turned on.
  if (rpcErrorHasFieldViolation(cause, "settings.names")) {
    fieldErrors[coinNameField(defaultLocale)] = t(
      "admin.coins.settings.validation.default_name_required",
      { language: getLocaleLabel(defaultLocale) }
    );
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
};

/**
 * Why turning coins on was refused without a reason of its own: the platform
 * has stopped allowing tenant coins since the screen was read, or neither the
 * payment provider nor an app store is ready to sell a pack. The two share a
 * code, so the allowance is read again to tell them apart.
 */
const cannotTurnOnMessage = async (
  tenantId: string,
  sessionId: string,
  t: AdminMessageAccessor
): Promise<string> => {
  try {
    const response = await apiClient.coins.getTenantCoinSettings(
      { tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    if (!response.platformAllowsCoins) {
      return t("admin.coins.settings.not_allowed");
    }
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
  }

  return t("admin.coins.settings.cannot_sell");
};

export const updateCoinSettings = async (
  input: {
    tenantId: string;
    settings: CoinSettings;
    /** The currency `coinUnitAmount` was read in. */
    currency: string;
    /** The tenant's word for its coins, for the copy of a refusal. */
    coinName: string;
    /** The language whose name the API requires while coins are on. */
    defaultLocale: Locale;
  },
  locale: Locale
): Promise<CoinSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const tenantId = input.tenantId.trim();

  if (!tenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  const { settings } = input;

  try {
    const response = await apiClient.coins.updateTenantCoinSettings(
      {
        currency: input.currency,
        settings: {
          coinUnitAmount: settings.coinUnitAmount,
          contact: settings.contact,
          enabled: settings.enabled,
          expiryDays: settings.expiryDays,
          issuerName: settings.issuerName,
          names: settings.names.map(({ locale: code, name }) => ({
            locale: code,
            name,
          })),
          notice: settings.notice,
          selling: settings.selling,
          termsUrl: settings.termsUrl,
        },
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true, ...toCoinSettingsRead(response) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const coinName = { coin_name: input.coinName };

    if (rpcErrorHasFieldViolation(error, "currency")) {
      return {
        fieldErrors: {
          coinUnitAmount: t("admin.series.episodes.currency_changed"),
        },
        message: t("errors.validation"),
        ok: false,
      };
    }

    const fieldErrors = refusedSettingsFieldErrors(
      error,
      settings.names,
      input.defaultLocale,
      t
    );

    if (fieldErrors) {
      return { fieldErrors, message: t("errors.validation"), ok: false };
    }

    const readerCount = rpcErrorReasonMetadataNumber(
      error,
      RPC_ERROR_REASON.coinBalancesOutstanding,
      RPC_ERROR_METADATA.readerCount
    );

    if (
      readerCount !== null ||
      rpcErrorHasReason(error, RPC_ERROR_REASON.coinBalancesOutstanding)
    ) {
      return {
        fieldErrors: {
          enabled: t("admin.coins.settings.balances_outstanding", {
            ...coinName,
            count: readerCount ?? 0,
          }),
        },
        message: t("errors.validation"),
        ok: false,
      };
    }

    if (rpcErrorHasReason(error, RPC_ERROR_REASON.coinUnitAmountFixed)) {
      return {
        fieldErrors: {
          coinUnitAmount: t("admin.coins.settings.unit_amount_fixed", coinName),
        },
        message: t("errors.validation"),
        ok: false,
      };
    }

    if (rpcErrorDisposition(error) === "precondition") {
      return {
        fieldErrors: {
          enabled: await cannotTurnOnMessage(tenantId, sessionId, t),
        },
        message: t("errors.validation"),
        ok: false,
      };
    }

    return {
      message: rpcErrorMessage(error, t("admin.coins.settings.save_failed"), {
        locale,
      }),
      ok: false,
    };
  }
};

/** The wording of a refused pack write, for the field or the rule it broke. */
const packErrorMessage = (
  cause: unknown,
  coinName: string,
  t: AdminMessageAccessor,
  locale: Locale,
  fallback: string
): string => {
  if (rpcErrorHasFieldViolation(cause, "pack.currency")) {
    return t("admin.series.episodes.currency_changed");
  }

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.coinPackSold)) {
    return t("admin.coins.packs.validation.sold", { coin_name: coinName });
  }

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.coinPackLimit)) {
    return t("admin.coins.packs.validation.limit", {
      count: COIN_PACK_LIMIT,
    });
  }

  let invalidArgument = t("errors.validation");

  if (rpcErrorHasFieldViolation(cause, "pack.coins")) {
    invalidArgument = t("admin.coins.packs.validation.coins_invalid", {
      coin_name: coinName,
    });
  } else if (rpcErrorHasFieldViolation(cause, "pack.bonus_coins")) {
    invalidArgument = t("admin.coins.packs.validation.bonus_coins_invalid", {
      coin_name: coinName,
    });
  } else if (rpcErrorHasFieldViolation(cause, "pack.price")) {
    invalidArgument = t("admin.coins.packs.validation.price_invalid");
  }

  return rpcErrorMessage(cause, fallback, {
    locale,
    overrides: {
      "invalid-argument": invalidArgument,
      "not-found": t("admin.coins.packs.not_found"),
    },
  });
};

const toPackInput = (pack: CoinPackInput) => ({
  bonusCoins: pack.bonusCoins,
  coins: pack.coins,
  currency: pack.currency,
  onSale: pack.onSale,
  price: pack.price,
  sortOrder: pack.sortOrder,
});

export const createCoinPack = async (
  input: { tenantId: string; pack: CoinPackInput; coinName: string },
  locale: Locale
): Promise<SaveCoinPackResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const tenantId = input.tenantId.trim();

  if (!tenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.coins.createCoinPack(
      { pack: toPackInput(input.pack), tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    if (!response.pack) {
      return { message: t("admin.coins.packs.save_failed"), ok: false };
    }

    return { ok: true, pack: toCoinPack(response.pack) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: packErrorMessage(
        error,
        input.coinName,
        t,
        locale,
        t("admin.coins.packs.save_failed")
      ),
      ok: false,
    };
  }
};

export const updateCoinPack = async (
  input: {
    tenantId: string;
    id: string;
    pack: CoinPackInput;
    coinName: string;
  },
  locale: Locale
): Promise<SaveCoinPackResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const tenantId = input.tenantId.trim();

  if (!tenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.coins.updateCoinPack(
      {
        coinPackId: input.id,
        pack: toPackInput(input.pack),
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.pack) {
      return { message: t("admin.coins.packs.save_failed"), ok: false };
    }

    return { ok: true, pack: toCoinPack(response.pack) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: packErrorMessage(
        error,
        input.coinName,
        t,
        locale,
        t("admin.coins.packs.save_failed")
      ),
      ok: false,
    };
  }
};

/**
 * The packs as the API holds them now, read past every cache: a write that
 * keeps a sold pack's price or places a pack after the others decides from
 * this, never from the list the screen was rendered from.
 */
export const readCoinPacksForWrite = async (
  tenantId: string,
  locale: Locale
): Promise<ListCoinPacksResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false, packs: [] };
  }

  try {
    const response = await apiClient.coins.listCoinPacks(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true, packs: (response.packs ?? []).map(toCoinPack) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(error, t("admin.coins.packs.list_failed"), {
        locale,
      }),
      ok: false,
      packs: [],
    };
  }
};

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Puts the packs in the order `ids` names. The API keeps a sort order on each
 * pack rather than taking a whole order, so every pack whose position moved is
 * saved with the position it now holds, and its other fields as stored.
 * `expectedIds` is the order the screen was showing: a list someone else has
 * changed in the meantime is refused rather than merged.
 */
export const reorderCoinPacks = async (
  input: { tenantId: string; ids: string[]; expectedIds: string[] },
  locale: Locale
): Promise<RetireCoinPackResult> => {
  const [t, current] = await Promise.all([
    getMessagesFor(locale),
    readCoinPacksForWrite(input.tenantId, locale),
  ]);

  if (!current.ok) {
    return { message: current.message, ok: false };
  }

  const currentIds = current.packs.map((pack) => pack.id);

  if (
    !sameIds(currentIds, input.expectedIds) ||
    !sameIds(currentIds.toSorted(), input.ids.toSorted())
  ) {
    return { message: t("admin.coins.packs.reorder_changed"), ok: false };
  }

  const byId = new Map(current.packs.map((pack) => [pack.id, pack]));

  const moved = input.ids.flatMap((id, sortOrder) => {
    const pack = byId.get(id);

    return pack && pack.sortOrder !== sortOrder ? [{ pack, sortOrder }] : [];
  });

  // Each pack is a write of its own, so the moves are sent together. The
  // price is the stored one, in whatever currency it was set in, so it is
  // written unchecked, and only the position changes.
  const results = await Promise.all(
    moved.map(({ pack, sortOrder }) =>
      updateCoinPack(
        {
          coinName: "",
          id: pack.id,
          pack: { ...pack, currency: "", sortOrder },
          tenantId: input.tenantId,
        },
        locale
      )
    )
  );

  if (results.some((result) => !result.ok)) {
    return { message: t("admin.coins.packs.reorder_failed"), ok: false };
  }

  return { ok: true };
};

export const retireCoinPack = async (
  input: { tenantId: string; id: string },
  locale: Locale
): Promise<RetireCoinPackResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const tenantId = input.tenantId.trim();

  if (!tenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.coins.retireCoinPack(
      { coinPackId: input.id, tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(error, t("admin.coins.packs.retire_failed"), {
        locale,
        overrides: { "not-found": t("admin.coins.packs.not_found") },
      }),
      ok: false,
    };
  }
};
