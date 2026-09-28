/**
 * The catalogs whose copy leaves the gap between CJK text and a Latin or digit
 * run to the renderer (`text-autospace` on the web). Korean is not one: its
 * spaces separate words, so they are part of the text.
 */
export const leavesSpacingToRenderer = (code: string): boolean =>
  ["ja", "zh"].includes(code.split("-")[0] ?? "");

// The classes CSS Text Level 4 gives `ideograph-alpha` and `ideograph-numeric`,
// without punctuation, as the mobile app's `AutospacedText` classifies them.
const ideograph = String.raw`(?:(?!\p{P})(?:[ぁ-ヿ㇀-ㇿ]|\p{Script_Extensions=Han}))`;
const wide = String.raw`[ᄀ-ᅟ々-ꒌꥠ-ꥼ가-힣豈-龎０-ｚ\u{16FE0}-\u{1B2FB}\u{20000}-\u{323AF}]`;
const letterOrNumeral = String.raw`(?:(?!${wide})[\p{L}\p{M}\p{Nd}])`;
// A `{$name}` reference, which is usually a number or a name in Latin script.
const reference = String.raw`\{\$[^{}]*\}`;

const spaceAtBoundary = new RegExp(
  String.raw`(?<=${ideograph}) +(?=${letterOrNumeral}|\{\$)|(?<=${letterOrNumeral}|${reference}) +(?=${ideograph})`,
  "gu"
);

/** The spaces [message] writes between CJK text and a Latin or digit run. */
export const cjkLatinSpaces = (message: string): string[] =>
  [...message.matchAll(spaceAtBoundary)].map((match) => {
    const start = Math.max(0, match.index - 4);
    const end = Math.min(message.length, match.index + match[0].length + 4);
    return message.slice(start, end);
  });
