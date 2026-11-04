import {
  PromotionCodeDiscountKind,
  PromotionCodeTargetKind,
} from "@publira/api-client/admin/promotion-code";
import { PurchaseKind } from "@publira/api-client/admin/types";
import type {
  PromotionCode,
  PromotionCodeRedemption,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { getMessagesFor } from "./messages";
import type {
  PromotionCodeDiscountKindValue,
  PromotionCodeItem,
  PromotionCodeTarget,
  PromotionCodeTargetKindValue,
} from "./promotion-code-shared";
import { getAccessToken } from "./session";

export interface PromotionCodeRedemptionItem {
  currency: string;
  id: string;
  /** The price before the code, in the minor unit of `currency`. */
  listPrice: number;
  /** What the reader paid. */
  price: number;
  /** The purchase, as `/purchases?purchase=` opens it. */
  purchaseId: string;
  /** Empty, with the public ID, once the reader deleted their account. */
  readerEmail: string;
  readerPublicId: string;
  redeemedAt: string;
  /** Whether the purchase was a rental rather than the permanent copy. */
  rental: boolean;
  /** The episode's or the volume's title in the tenant's default locale. */
  title: string;
}

export type ListPromotionCodesResult = CursorPageTokens & {
  codes: PromotionCodeItem[];
  message?: string;
  ok: boolean;
  /** The API rejected the session — the page raises the login redirect. */
  requiresSignIn?: boolean;
};

export type GetPromotionCodeResult =
  | {
      /** `null` when the tenant holds no such code, or deleted it. */
      code: PromotionCodeItem | null;
      ok: true;
    }
  | { message: string; ok: false; requiresSignIn?: boolean };

export type ListPromotionCodeRedemptionsResult = CursorPageTokens & {
  message?: string;
  ok: boolean;
  redemptions: PromotionCodeRedemptionItem[];
  requiresSignIn?: boolean;
};

/** The limits a create and an edit both send. */
export interface PromotionCodeLimitsInput {
  /** An RFC 3339 instant, or `""` for no end. */
  endsAt: string;
  /** `0` for no limit. */
  maxRedemptions: number;
  maxRedemptionsPerReader: number;
  /** An RFC 3339 instant, or `""` for no start. */
  startsAt: string;
}

export interface CreatePromotionCodeInput {
  code: string;
  /** Read for an amount alone: the currency the form showed it in. */
  currency: string;
  discountKind: PromotionCodeDiscountKindValue;
  /** The percentage, or the amount in the minor unit of `currency`. */
  discountValue: number;
  limits: PromotionCodeLimitsInput;
  targetId: string;
  targetKind: PromotionCodeTargetKindValue;
  tenantId: string;
}

export type SavePromotionCodeResult =
  | { code: PromotionCodeItem; ok: true }
  | {
      fieldErrors?: ActionForm.FieldErrors;
      message: string;
      ok: false;
    };

export type ChangePromotionCodeResult =
  | { code: PromotionCodeItem; ok: true }
  | { message: string; ok: false };

export type DeletePromotionCodeResult =
  | { ok: true }
  | { message: string; ok: false };

const discountKinds: Record<
  PromotionCodeDiscountKindValue,
  PromotionCodeDiscountKind
> = {
  amount: PromotionCodeDiscountKind.AMOUNT,
  percent: PromotionCodeDiscountKind.PERCENT,
};

const targetKinds: Record<
  PromotionCodeTargetKindValue,
  PromotionCodeTargetKind
> = {
  catalog: PromotionCodeTargetKind.CATALOG,
  episode: PromotionCodeTargetKind.EPISODE,
  label: PromotionCodeTargetKind.LABEL,
  series: PromotionCodeTargetKind.SERIES,
  volume: PromotionCodeTargetKind.VOLUME,
};

const targetKindValues: Partial<
  Record<
    PromotionCodeTargetKind,
    Exclude<PromotionCodeTargetKindValue, "catalog">
  >
> = {
  [PromotionCodeTargetKind.EPISODE]: "episode",
  [PromotionCodeTargetKind.LABEL]: "label",
  [PromotionCodeTargetKind.SERIES]: "series",
  [PromotionCodeTargetKind.VOLUME]: "volume",
};

/** The generated `PromotionCode` fields {@link mapPromotionCode} reads (see `series.ts`). */
type RawPromotionCode = Pick<
  PromotionCode,
  | "code"
  | "createdAt"
  | "currency"
  | "discountKind"
  | "discountValue"
  | "id"
  | "limits"
  | "pausedAt"
  | "redemptionCount"
  | "targetId"
  | "targetKind"
  | "targetTitle"
>;

const mapTarget = (code: RawPromotionCode): PromotionCodeTarget => {
  const kind = targetKindValues[code.targetKind];

  return kind
    ? { id: code.targetId, kind, title: code.targetTitle }
    : { kind: "catalog" };
};

export const mapPromotionCode = (
  code: RawPromotionCode
): PromotionCodeItem => ({
  code: code.code,
  createdAt: code.createdAt,
  discount:
    code.discountKind === PromotionCodeDiscountKind.AMOUNT
      ? {
          amount: code.discountValue,
          currency: code.currency,
          kind: "amount",
        }
      : { kind: "percent", percent: code.discountValue },
  endsAt: code.limits?.endsAt ?? "",
  id: code.id,
  maxRedemptions: code.limits?.maxRedemptions ?? 0,
  maxRedemptionsPerReader: code.limits?.maxRedemptionsPerReader ?? 0,
  pausedAt: code.pausedAt,
  redemptionCount: code.redemptionCount,
  startsAt: code.limits?.startsAt ?? "",
  target: mapTarget(code),
});

/** The generated `PromotionCodeRedemption` fields {@link mapRedemption} reads. */
type RawPromotionCodeRedemption = Pick<
  PromotionCodeRedemption,
  | "currency"
  | "id"
  | "kind"
  | "listPrice"
  | "price"
  | "purchaseId"
  | "readerEmail"
  | "readerPublicId"
  | "redeemedAt"
  | "title"
>;

export const mapRedemption = (
  redemption: RawPromotionCodeRedemption
): PromotionCodeRedemptionItem => ({
  currency: redemption.currency,
  id: redemption.id,
  listPrice: redemption.listPrice,
  price: redemption.price,
  purchaseId: redemption.purchaseId,
  readerEmail: redemption.readerEmail,
  readerPublicId: redemption.readerPublicId,
  redeemedAt: redemption.redeemedAt,
  rental: redemption.kind === PurchaseKind.RENTAL,
  title: redemption.title,
});

/**
 * The tag every promotion code read carries: the list, one code, and its
 * redemptions. A change to a code changes its row in the list as well as the
 * drawer, so one tag reaches all of them.
 *
 * The tag reaches only what this console changes. A purchase on the
 * storefront or in the app redeems a code without it, which changes a code's
 * count and its redemptions, so every read also declares
 * `cacheLife("minutes")` and is refetched once it is a minute old.
 */
export const promotionCodesCacheTag = (tenantId: string): string =>
  `promotion-codes-${tenantId}`;

const listPromotionCodesForSession = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions,
  sessionId: string
): Promise<CachedRead<ListPromotionCodesResult>> => {
  "use cache: private";
  cacheTag(promotionCodesCacheTag(tenantId));
  cacheLife("minutes");

  const t = await getMessagesFor(locale);

  if (!sessionId) {
    dropFailedCacheEntry();

    return {
      ...emptyCursorPageTokens,
      codes: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.promotionCodes.listPromotionCodes(
      { ...cursorPageRequest(options), tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      codes: response.promotionCodes.map(mapPromotionCode),
      ok: true,
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      ...emptyCursorPageTokens,
      codes: [],
      message: rpcErrorMessage(error, t("admin.promotion_codes.list_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/**
 * One page of the tenant's codes that are not deleted, newest first, in the
 * server's keyset order.
 *
 * Read with the operator's session: every RPC of the service is for a Tenant
 * admin alone, and admits no service credential.
 */
export const listPromotionCodes = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions = {}
): Promise<ListPromotionCodesResult> =>
  settleCachedRead(
    await listPromotionCodesForSession(
      tenantId,
      locale,
      options,
      await getAccessToken()
    )
  );

const getPromotionCodeForSession = async (
  tenantId: string,
  promotionCodeId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<GetPromotionCodeResult>> => {
  "use cache: private";
  cacheTag(promotionCodesCacheTag(tenantId));
  cacheLife("minutes");

  const t = await getMessagesFor(locale);

  if (!sessionId) {
    dropFailedCacheEntry();

    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.promotionCodes.getPromotionCode(
      { promotionCodeId, tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      code: response.promotionCode
        ? mapPromotionCode(response.promotionCode)
        : null,
      ok: true,
    };
  } catch (error) {
    // A code another tenant holds, one deleted, or one that never existed is
    // an answer rather than a failure: the drawer says so.
    if (isMissingResourceRpcError(error)) {
      return { code: null, ok: true };
    }

    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(
        error,
        t("admin.promotion_codes.detail_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** One code of the tenant, for the drawer. */
export const getPromotionCode = async (
  tenantId: string,
  promotionCodeId: string,
  locale: Locale
): Promise<GetPromotionCodeResult> =>
  settleCachedRead(
    await getPromotionCodeForSession(
      tenantId,
      promotionCodeId,
      locale,
      await getAccessToken()
    )
  );

const listPromotionCodeRedemptionsForSession = async (
  tenantId: string,
  promotionCodeId: string,
  locale: Locale,
  options: CursorPageOptions,
  sessionId: string
): Promise<CachedRead<ListPromotionCodeRedemptionsResult>> => {
  "use cache: private";
  cacheTag(promotionCodesCacheTag(tenantId));
  cacheLife("minutes");

  const t = await getMessagesFor(locale);

  if (!sessionId) {
    dropFailedCacheEntry();

    return {
      ...emptyCursorPageTokens,
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      redemptions: [],
      requiresSignIn: true,
    };
  }

  try {
    const response =
      await apiClient.promotionCodes.listPromotionCodeRedemptions(
        {
          ...cursorPageRequest(options),
          promotionCodeId,
          tenant: { tenantId },
        },
        withSessionHeaders(sessionId)
      );

    return {
      ...cursorPageTokens(response),
      ok: true,
      redemptions: response.redemptions.map(mapRedemption),
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      ...emptyCursorPageTokens,
      message: rpcErrorMessage(
        error,
        t("admin.promotion_codes.redemptions.list_failed"),
        { locale }
      ),
      ok: false,
      redemptions: [],
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** One page of the purchases a code discounted, newest first. */
export const listPromotionCodeRedemptions = async (
  tenantId: string,
  promotionCodeId: string,
  locale: Locale,
  options: CursorPageOptions = {}
): Promise<ListPromotionCodeRedemptionsResult> =>
  settleCachedRead(
    await listPromotionCodeRedemptionsForSession(
      tenantId,
      promotionCodeId,
      locale,
      options,
      await getAccessToken()
    )
  );

/**
 * The form field each of the API's field violations is about, keyed by the
 * name the form posts it under.
 */
const fieldViolations = [
  ["code", "code"],
  ["discount_value", "discount_value"],
  ["currency", "discount_value"],
  ["target_id", "target_id"],
  ["limits.starts_at", "starts_at"],
  ["limits.ends_at", "ends_at"],
  ["limits.max_redemptions", "max_redemptions"],
  ["limits.max_redemptions_per_reader", "max_redemptions_per_reader"],
] as const;

/**
 * What a refused create or edit says beside each field the API named:
 * a code already in use, a code spelled with something other than letters and
 * digits, a discount out of its range, a target that is gone, and a window
 * that ends before it starts. `undefined` for a refusal that names no field.
 */
const refusedFieldErrors = async (
  cause: unknown,
  locale: Locale
): Promise<ActionForm.FieldErrors | undefined> => {
  const disposition = rpcErrorDisposition(cause);
  const t = await getMessagesFor(locale);

  if (disposition === "conflict") {
    return { code: t("admin.promotion_codes.validation.code_in_use") };
  }

  if (disposition !== "invalid-argument" && disposition !== "precondition") {
    return undefined;
  }

  const messages: Record<(typeof fieldViolations)[number][1], string> = {
    code: t("admin.promotion_codes.validation.code_invalid"),
    discount_value: rpcErrorHasFieldViolation(cause, "currency")
      ? t("admin.promotion_codes.validation.currency_changed")
      : t("admin.promotion_codes.validation.discount_invalid"),
    ends_at: t("admin.promotion_codes.validation.ends_before_starts"),
    max_redemptions: t("admin.promotion_codes.validation.limit_invalid"),
    max_redemptions_per_reader: t(
      "admin.promotion_codes.validation.limit_invalid"
    ),
    starts_at: t("admin.promotion_codes.validation.starts_at_invalid"),
    target_id: t("admin.promotion_codes.validation.target_missing"),
  };

  const fieldErrors: ActionForm.FieldErrors = {};

  for (const [violation, field] of fieldViolations) {
    if (rpcErrorHasFieldViolation(cause, violation)) {
      fieldErrors[field] = messages[field];
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
};

const saveFailure = async (
  cause: unknown,
  locale: Locale
): Promise<Extract<SavePromotionCodeResult, { ok: false }>> => {
  const [t, fieldErrors] = await Promise.all([
    getMessagesFor(locale),
    refusedFieldErrors(cause, locale),
  ]);

  if (fieldErrors) {
    return { fieldErrors, message: t("errors.validation"), ok: false };
  }

  return {
    message: rpcErrorMessage(cause, t("admin.promotion_codes.save_failed"), {
      locale,
      overrides: { "not-found": t("admin.promotion_codes.not_found") },
    }),
    ok: false,
  };
};

const toLimits = (limits: PromotionCodeLimitsInput) => ({
  endsAt: limits.endsAt,
  maxRedemptions: limits.maxRedemptions,
  maxRedemptionsPerReader: limits.maxRedemptionsPerReader,
  startsAt: limits.startsAt,
});

/** Creates a code. Its code, discount, and target are fixed from then on. */
export const createPromotionCode = async (
  input: CreatePromotionCodeInput,
  locale: Locale
): Promise<SavePromotionCodeResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.promotionCodes.createPromotionCode(
      {
        code: input.code,
        currency: input.discountKind === "amount" ? input.currency : "",
        discountKind: discountKinds[input.discountKind],
        discountValue: input.discountValue,
        limits: toLimits(input.limits),
        targetId: input.targetKind === "catalog" ? "" : input.targetId,
        targetKind: targetKinds[input.targetKind],
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.promotionCode) {
      return { message: t("admin.promotion_codes.save_failed"), ok: false };
    }

    return { code: mapPromotionCode(response.promotionCode), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return saveFailure(error, locale);
  }
};

/** Replaces a code's window and limits, the part of it that can change. */
export const updatePromotionCode = async (
  input: {
    id: string;
    limits: PromotionCodeLimitsInput;
    tenantId: string;
  },
  locale: Locale
): Promise<SavePromotionCodeResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.promotionCodes.updatePromotionCode(
      {
        limits: toLimits(input.limits),
        promotionCodeId: input.id,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.promotionCode) {
      return { message: t("admin.promotion_codes.save_failed"), ok: false };
    }

    return { code: mapPromotionCode(response.promotionCode), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return saveFailure(error, locale);
  }
};

/** Pauses a code, which refuses it until it is resumed, or resumes it. */
export const setPromotionCodePaused = async (
  input: { id: string; paused: boolean; tenantId: string },
  locale: Locale
): Promise<ChangePromotionCodeResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  const request = {
    promotionCodeId: input.id,
    tenant: { tenantId: input.tenantId },
  };

  try {
    const response = input.paused
      ? await apiClient.promotionCodes.pausePromotionCode(
          request,
          withSessionHeaders(sessionId)
        )
      : await apiClient.promotionCodes.resumePromotionCode(
          request,
          withSessionHeaders(sessionId)
        );

    if (!response.promotionCode) {
      return { message: t("admin.promotion_codes.change_failed"), ok: false };
    }

    return { code: mapPromotionCode(response.promotionCode), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.promotion_codes.change_failed"),
        {
          locale,
          overrides: { "not-found": t("admin.promotion_codes.not_found") },
        }
      ),
      ok: false,
    };
  }
};

/**
 * Deletes a code, which refuses it from then on and frees its name. The
 * purchases it discounted and its redemptions keep naming it.
 */
export const deletePromotionCode = async (
  input: { id: string; tenantId: string },
  locale: Locale
): Promise<DeletePromotionCodeResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.promotionCodes.deletePromotionCode(
      { promotionCodeId: input.id, tenant: { tenantId: input.tenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.promotion_codes.delete_failed"),
        {
          locale,
          overrides: { "not-found": t("admin.promotion_codes.not_found") },
        }
      ),
      ok: false,
    };
  }
};
