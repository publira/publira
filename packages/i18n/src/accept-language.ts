/**
 * Pick the locale a screen with no identified reader opens on, from
 * `Accept-Language`.
 *
 * Platform and tenant setup have no stored preference to read yet, so the
 * request header is the only signal about the person in front of the screen.
 * The result is a *candidate*: it seeds the first render and the selector's
 * initial option, and the value that gets saved is whatever the operator then
 * picks from the supported locales. Nothing here writes a preference.
 *
 * The same holds for a screen that exists to create a session — the platform
 * console's login form, where reading the stored default needs the session
 * that screen has not issued yet. What those two cases share is that nobody
 * has identified themselves, so there is no stored preference to lose. A path
 * that *does* have one and could not read it has to say so instead: renegotiating
 * would replace the operator's saved language with their browser's.
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
 * The language and script `tag` stands for once BCP 47 likely subtags have
 * filled in what it leaves out: `zh-Hant-TW` and `zh-TW` are both `zh-Hant`,
 * `zh-CN` and a bare `zh` are both `zh-Hans`, and `ko-KR` is `ko-Kore`.
 *
 * `Intl.Locale.prototype.maximize()` is that derivation, so the region a tag
 * names decides its script from the same data the rest of the platform reads
 * rather than from a table kept here.
 *
 * `undefined` when the tag is not one BCP 47 can hold —
 * {@link LANGUAGE_RANGE_PATTERN} admits shapes such as `abcd` that RFC 9110
 * allows and BCP 47 does not — or when the language has no likely script.
 */
const languageAndScript = (tag: string): string | undefined => {
  try {
    const { language, script } = new Intl.Locale(tag).maximize();

    return script === undefined ? undefined : `${language}-${script}`;
  } catch {
    return undefined;
  }
};

/**
 * The locale of `supported` a single range asks for, tried from the most
 * specific match to the least: the code itself, then a locale written in the
 * same language and script, then any locale in the same language. `en-GB`
 * reaches `en` at the second step and `zh-TW` reaches `zh-Hant` rather than
 * whichever Chinese locale `supported` lists first; the third step is what a
 * range such as `zh-Latn-PY`, whose script no locale here is written in,
 * still matches through.
 *
 * Tags are case-insensitive, and `supported` holds the canonical casing. When
 * several entries match equally well the first one listed wins, so the order
 * of `locales/index.json` breaks the tie.
 */
export const matchSupportedLocale = <T extends string>(
  range: string,
  supported: readonly T[]
): T | undefined => {
  const wanted = range.toLowerCase();
  const exact = supported.find((locale) => locale.toLowerCase() === wanted);
  if (exact !== undefined) {
    return exact;
  }

  const wantedLanguageAndScript = languageAndScript(range);
  if (wantedLanguageAndScript !== undefined) {
    const sameScript = supported.find(
      (locale) => languageAndScript(locale) === wantedLanguageAndScript
    );
    if (sameScript !== undefined) {
      return sameScript;
    }
  }

  const [language] = wanted.split("-");

  return supported.find(
    (locale) => locale.toLowerCase().split("-")[0] === language
  );
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
    const locale = matchSupportedLocale(range, SUPPORTED_LOCALES);
    if (locale !== undefined) {
      return locale;
    }
  }

  return FALLBACK_LOCALE;
};
