/**
 * The longest code a tenant can hold. The server admits 1 to 32 ASCII letters
 * and digits, and a field or a search parameter that takes more holds no code
 * of the tenant's.
 */
export const PROMOTION_CODE_MAX_LENGTH = 32;

const PROMOTION_CODE_PATTERN = /^[A-Za-z0-9]{1,32}$/u;

/**
 * Whether `code` is spelled as a tenant's code can be. One that is not is
 * refused as unknown without asking the server, which would spend one of the
 * reader's lookups to say the same.
 */
export const isPromotionCodeSpelling = (code: string): boolean =>
  PROMOTION_CODE_PATTERN.test(code);

/**
 * Why a code was not applied, one per wording the field gives under itself.
 * `rate_limited` is the reader past their allowance of lookups, and `error`
 * an answer the reader can do nothing about but try again.
 */
export type PromotionCodeRefusal =
  | "already_redeemed"
  | "error"
  | "exhausted"
  | "expired"
  | "invalid"
  | "not_applicable"
  | "rate_limited";

/** Which of an episode's sales a code is quoted against. */
export type EpisodeSaleKind = "purchase" | "rental";

/**
 * The sales an episode's gate offers: the permanent copy, and the rental where
 * the episode is rented, which takes both a price and a period.
 */
export const episodeSaleKinds = ({
  rentalPeriodHours,
  rentalPrice,
}: {
  rentalPeriodHours: number;
  rentalPrice: number;
}): readonly EpisodeSaleKind[] =>
  rentalPrice > 0 && rentalPeriodHours > 0
    ? ["purchase", "rental"]
    : ["purchase"];

/** What one sale costs with the code, in the tenant's minor unit. */
export interface PromotionCodeQuote {
  /** The price the code was taken off. */
  listPrice: number;
  /** What the reader would pay. */
  price: number;
}

/**
 * The code field's answer, for the sales named by `K`: no code, a code that
 * applies to at least one of them, with the price of each it applies to, or a
 * code that applies to none, with the reason.
 */
export type PromotionCodeState<K extends string> =
  | { kind: "none" }
  | {
      code: string;
      kind: "applied";
      /** Absent for a sale the code does not apply to, which keeps its price. */
      quotes: Partial<Record<K, PromotionCodeQuote>>;
    }
  | { code: string; kind: "refused"; reason: PromotionCodeRefusal };

export const NO_PROMOTION_CODE = { kind: "none" } as const;
