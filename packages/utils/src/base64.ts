/**
 * Decodes a Base64URL value into its original bytes.
 *
 * `Uint8Array.fromBase64()` avoids the intermediate binary string that
 * `atob()` creates. Older browsers do not implement it yet, so use `atob()`
 * only as a compatibility fallback.
 */
export const decodeBase64Url = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*={0,2}$/u.test(value)) {
    return null;
  }

  if (typeof Uint8Array.fromBase64 === "function") {
    try {
      return Uint8Array.fromBase64(value, { alphabet: "base64url" });
    } catch {
      return null;
    }
  }

  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(
      binary,
      (character) => character.codePointAt(0) ?? 0
    );
  } catch {
    return null;
  }
};
