const PROBE_ORIGIN = "https://publira.invalid";

/** C0 controls and DEL, which a URL parser strips or rejects. */
const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
};

/**
 * Whether `value` is a path that stays on the origin it is resolved against —
 * the test a return destination or a link has to pass before it reaches
 * `redirect()` or an `href`.
 *
 * Reading the string is not enough, because a browser does not keep it as
 * written: it reads `/\evil.example` as `//evil.example`, and it drops a tab
 * or a line break anywhere, so `/<TAB>/evil.example` becomes
 * `//evil.example` too. The value is therefore resolved the way a browser
 * would resolve it and must keep the origin it was resolved against, and it
 * may carry no control character and no backslash before its query, where a
 * browser could later read either as something else. A backslash in the query
 * or the fragment is literal to every parser, so it is allowed there.
 */
export const isSameOriginPath = (value: string): boolean => {
  if (!value.startsWith("/") || hasControlCharacter(value)) {
    return false;
  }

  const suffixStart = value.search(/[?#]/u);
  const pathname = suffixStart === -1 ? value : value.slice(0, suffixStart);

  if (pathname.includes("\\")) {
    return false;
  }

  try {
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
};
