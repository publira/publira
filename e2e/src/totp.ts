import "temporal-polyfill/global";
import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const decodeBase32 = (encoded: string): Buffer => {
  const bits = [...encoded.replace(/(?<!=)=+$/u, "").toUpperCase()]
    .map((character) => {
      const value = BASE32_ALPHABET.indexOf(character);
      if (value === -1) {
        throw new Error(`not a base32 character: ${character}`);
      }
      return value.toString(2).padStart(5, "0");
    })
    .join("");
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
};

/**
 * The code an authenticator app shows for `secret` right now, with the
 * parameters `server/internal/mfa/totp.go` enrolls: RFC 6238 over HMAC-SHA1,
 * six digits, a 30-second step.
 *
 * `stepsAhead` asks for the code of a later step instead. The server accepts
 * each step once and one step either side of the current one, so a suite that
 * presents a second code within the step it has already spent reaches for the
 * next one rather than waiting for the clock.
 */
export const totpCode = (secret: string, stepsAhead = 0): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(
    BigInt(
      Math.floor(Temporal.Now.instant().epochMilliseconds / 30_000) + stepsAhead
    )
  );
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counter)
    .digest();
  const offset = (digest.at(-1) ?? 0) % 16;
  // RFC 4226 drops the top bit so the value reads the same signed or unsigned.
  const binary = digest.readUInt32BE(offset) % 2 ** 31;
  return String(binary % 1_000_000).padStart(6, "0");
};
