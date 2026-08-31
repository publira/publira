/**
 * Pick the locale a first-run setup screen opens on, from `Accept-Language`.
 *
 * Platform and tenant setup have no stored preference to read yet, so the
 * request header is the only signal about the person in front of the screen.
 * The result is a *candidate*: it seeds the first render and the selector's
 * initial option, and the value that gets saved is whatever the operator then
 * picks from the supported locales. Nothing here writes a preference, and no
 * other path should use it as a stand-in for one — a route that lost a stored
 * locale has to say so rather than re-negotiate a new one.
 *
 * The caller passes the header value (`(await headers()).get("accept-language")`),
 * so this module reads no request state and stays testable as a pure function.
 */

import { getLocales } from "./gen/locale-registry";
import type { Locale } from "./gen/locale-registry";

/**
 * Locale to open on when the header names nothing this repository supports.
 *
 * Annotated as {@link Locale} rather than inferred, so dropping `en` from
 * `locales/index.json` fails to compile instead of silently negotiating a
 * locale that has no catalog.
 */
const FALLBACK_LOCALE: Locale = "en";

const SUPPORTED_LOCALES = getLocales();

/**
 * `language-range` of RFC 9110 §12.5.4: a primary tag of up to eight letters,
 * then any number of alphanumeric subtags. The wildcard `*` is deliberately
 * excluded — see {@link negotiateInitialLocale}.
 */
const LANGUAGE_RANGE_PATTERN = /^[a-z]{1,8}(?:-[a-z\d]{1,8})*$/iu;

/**
 * `weight`: the only parameter `Accept-Language` allows. A qvalue is `0` or
 * `1` with at most three fractional digits, so `q=2` and `q=0.5000` are
 * malformed rather than clamped.
 */
const WEIGHT_PATTERN = /^q=(?<weight>0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/iu;

interface WeightedRange {
  readonly range: string;
  readonly weight: number;
}

const parseElement = (element: string): WeightedRange | undefined => {
  const [range, ...parameters] = element.split(";").map((part) => part.trim());

  if (!LANGUAGE_RANGE_PATTERN.test(range)) {
    return undefined;
  }

  if (parameters.length === 0) {
    return { range, weight: 1 };
  }

  if (parameters.length > 1) {
    return undefined;
  }

  const weight = WEIGHT_PATTERN.exec(parameters[0])?.groups?.weight;
  if (weight === undefined) {
    return undefined;
  }

  return { range, weight: Number(weight) };
};

/**
 * The supported locale a single range asks for: the code itself when the range
 * names one, otherwise the base language a subtagged range such as `en-US` or
 * `zh-Hant-TW` belongs to. Tags are case-insensitive, and `locales/index.json`
 * holds the canonical casing.
 */
const matchSupportedLocale = (range: string): Locale | undefined => {
  const wanted = range.toLowerCase();
  const exact = SUPPORTED_LOCALES.find(
    (locale) => locale.toLowerCase() === wanted
  );
  if (exact !== undefined) {
    return exact;
  }

  const [base] = wanted.split("-");

  return SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === base);
};

/**
 * The supported locale to show first for `acceptLanguage`, or `en` when the
 * header is missing, unparseable, or asks only for locales this repository
 * does not have. The return value is always one of `locales/index.json`.
 *
 * Ranges are tried by descending qvalue, and by header order within a tie, the
 * way RFC 9110 §12.5.4 orders them. `q=0` rejects a range, so such an entry is
 * never chosen. A malformed element is dropped on its own — a bad qvalue in
 * the middle of a header does not discard the ranges around it.
 *
 * The wildcard `*` is ignored rather than treated as a match. It says the
 * client accepts anything, which is not a preference, and honouring it would
 * make the opening locale depend on the order `locales/index.json` happens to
 * list its entries in; `en` is the decision this repository already made for
 * "no usable preference".
 */
export const negotiateInitialLocale = (
  acceptLanguage: string | null | undefined
): Locale => {
  if (typeof acceptLanguage !== "string") {
    return FALLBACK_LOCALE;
  }

  const accepted: WeightedRange[] = [];
  for (const element of acceptLanguage.split(",")) {
    const parsed = parseElement(element);
    if (parsed !== undefined && parsed.weight > 0) {
      accepted.push(parsed);
    }
  }
  accepted.sort((a, b) => b.weight - a.weight);

  for (const { range } of accepted) {
    const locale = matchSupportedLocale(range);
    if (locale !== undefined) {
      return locale;
    }
  }

  return FALLBACK_LOCALE;
};
