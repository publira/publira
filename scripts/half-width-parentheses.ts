/** What a half-width parenthesis in Japanese is set off from by a space. */
const WORD = /[\p{L}\p{N}]/u;

/**
 * The positions in a run of characters where a half-width parenthesis touches
 * a letter or a digit on its outer side, as `表示されます(任意)` does. Run
 * straight into Japanese, a half-width parenthesis is hard to pick out, so the
 * Japanese documentation and catalog set it off with a space there, and leave
 * the side that meets punctuation as it is.
 */
export const gluedParentheses = (chars: readonly string[]): number[] =>
  chars.flatMap((char, index) => {
    if (char !== "(" && char !== ")") {
      return [];
    }

    const outside = chars[char === "(" ? index - 1 : index + 1];

    return outside && WORD.test(outside) ? [index] : [];
  });

/** The catalogs whose copy sets a half-width parenthesis off with a space. */
export const spacesParentheses = (code: string): boolean =>
  code.split("-")[0] === "ja";

// A `{$name}` reference, which renders as a number or a name.
const reference = /\{\$[^{}]*\}/gu;

/**
 * The excerpts of a catalog message around each half-width parenthesis that a
 * letter, a digit, or a variable reference touches on its outer side.
 */
export const catalogGluedParentheses = (message: string): string[] => {
  const chars = [...message];

  const masked = [
    ...message.replaceAll(reference, (match) => "x".repeat([...match].length)),
  ];

  return gluedParentheses(masked).map((index) =>
    chars.slice(Math.max(0, index - 4), index + 5).join("")
  );
};
