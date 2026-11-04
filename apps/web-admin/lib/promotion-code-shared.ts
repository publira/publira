import { parseInstant } from "@publira/utils";

/** The longest code the API takes: 1 to 32 ASCII letters and digits. */
export const PROMOTION_CODE_MAX_LENGTH = 32;

/** What a code is made of, as the API checks it. */
export const PROMOTION_CODE_PATTERN = "[A-Za-z0-9]{1,32}";

/** How a code takes its discount off a price. */
export const PROMOTION_CODE_DISCOUNT_KINDS = ["percent", "amount"] as const;

export type PromotionCodeDiscountKindValue =
  (typeof PROMOTION_CODE_DISCOUNT_KINDS)[number];

/** What a code applies to. */
export const PROMOTION_CODE_TARGET_KINDS = [
  "catalog",
  "label",
  "series",
  "volume",
  "episode",
] as const;

export type PromotionCodeTargetKindValue =
  (typeof PROMOTION_CODE_TARGET_KINDS)[number];

export const isPromotionCodeTargetKind = (
  value: string
): value is PromotionCodeTargetKindValue =>
  PROMOTION_CODE_TARGET_KINDS.some((kind) => kind === value);

export const isPromotionCodeDiscountKind = (
  value: string
): value is PromotionCodeDiscountKindValue =>
  PROMOTION_CODE_DISCOUNT_KINDS.some((kind) => kind === value);

export type PromotionCodeDiscount =
  /** A whole percentage of the price, 1 to 100, rounded down. */
  | { kind: "percent"; percent: number }
  /** An amount in the minor unit of `currency`, the tenant's. */
  | { amount: number; currency: string; kind: "amount" };

export type PromotionCodeTarget =
  | { kind: "catalog" }
  | {
      /** The label, series, volume, or episode, a UUID. */
      id: string;
      kind: Exclude<PromotionCodeTargetKindValue, "catalog">;
      /**
       * Its name or title in the tenant's default locale, empty once it no
       * longer exists, when the code applies to nothing.
       */
      title: string;
    };

export interface PromotionCodeItem {
  code: string;
  createdAt: string;
  discount: PromotionCodeDiscount;
  /** An RFC 3339 instant, or `""` for no end. */
  endsAt: string;
  /** The UUID every RPC addresses the code by. */
  id: string;
  /** `0` for no limit. */
  maxRedemptions: number;
  /** `0` for no limit. */
  maxRedemptionsPerReader: number;
  /** When the code was paused, or `""` while it is not. */
  pausedAt: string;
  redemptionCount: number;
  /** An RFC 3339 instant, or `""` for no start. */
  startsAt: string;
  target: PromotionCodeTarget;
}

/**
 * Where a code stands at `now`. A code past its end has ended whether or not
 * it was paused, since resuming it would open nothing; a paused code is
 * reported as paused before its window is read, since that is what refuses it.
 */
export type PromotionCodeStatus = "active" | "ended" | "paused" | "scheduled";

export const promotionCodeStatus = (
  code: Pick<PromotionCodeItem, "endsAt" | "pausedAt" | "startsAt">,
  now: Temporal.Instant
): PromotionCodeStatus => {
  const end = parseInstant(code.endsAt);

  if (end && Temporal.Instant.compare(end, now) <= 0) {
    return "ended";
  }

  if (code.pausedAt) {
    return "paused";
  }

  const start = parseInstant(code.startsAt);

  if (start && Temporal.Instant.compare(start, now) > 0) {
    return "scheduled";
  }

  return "active";
};

/** One choice of a target picker: a label, a series, a volume, or an episode. */
export interface PromotionCodeTargetOption {
  id: string;
  label: string;
}

export type ListPromotionCodeTargetOptionsResult =
  | { ok: true; options: PromotionCodeTargetOption[] }
  | { message: string; ok: false; options: PromotionCodeTargetOption[] };
