/**
 * Decodes a Base64URL value into its original bytes.
 *
 * `Uint8Array.fromBase64()` avoids the intermediate binary string that
 * `atob()` creates. Older browsers do not implement it yet, so use `atob()`
 * only as a compatibility fallback.
 */
type Uint8ArrayWithBase64 = typeof Uint8Array & {
  fromBase64?: (value: string) => Uint8Array;
};

export const decodeBase64Url = (value: string): Uint8Array | null => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    return null;
  }

  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  const uint8Array = Uint8Array as Uint8ArrayWithBase64;
  if (typeof uint8Array.fromBase64 === "function") {
    try {
      return uint8Array.fromBase64(padded);
    } catch {
      return null;
    }
  }

  try {
    const binary = atob(padded);
    return Uint8Array.from(
      binary,
      (character) => character.codePointAt(0) ?? 0
    );
  } catch {
    return null;
  }
};
