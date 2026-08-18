import { CompactEncrypt, compactDecrypt } from "jose";

export interface WebSessionPayload {
  accessToken: string;
  expiresAt: string;
  name?: string;
  publicId?: string;
  role?: string;
  tenantId?: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// A256GCM takes exactly 32 bytes, so a shorter secret cannot key the JWE at all.
const AES_GCM_KEY_BYTES = 32;

const toAesGcmKeyBytes = (secret: string): Uint8Array => {
  const raw = textEncoder.encode(secret);
  if (raw.length < AES_GCM_KEY_BYTES) {
    throw new Error(
      `PUBLIRA_AUTH_SECRET must be at least ${AES_GCM_KEY_BYTES} bytes`
    );
  }
  return raw.slice(0, AES_GCM_KEY_BYTES);
};

export const encryptSessionPayload = (
  payload: WebSessionPayload,
  secret: string
): Promise<string> => {
  const key = toAesGcmKeyBytes(secret);
  return new CompactEncrypt(textEncoder.encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(key);
};

export const decryptSessionPayload = async (
  token: string,
  secret: string
): Promise<WebSessionPayload | null> => {
  // Outside the try: an unusable key is a misconfigured deployment, and
  // reporting it as "no session" would send every visitor to the login screen.
  const key = toAesGcmKeyBytes(secret);
  try {
    const { plaintext } = await compactDecrypt(token, key);
    const parsed = JSON.parse(
      textDecoder.decode(plaintext)
    ) as WebSessionPayload;
    if (!parsed.accessToken || !parsed.expiresAt) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const isSessionExpired = (
  expiresAt: string,
  now = Date.now()
): boolean => {
  const exp = Date.parse(expiresAt);
  if (Number.isNaN(exp)) {
    return true;
  }
  return exp <= now;
};

/**
 * The key every app's session cookie is sealed with.
 *
 * There is deliberately no fallback: a built-in value would be published in
 * this repository, and it keys a JWE whose payload carries the API access
 * token. Anyone holding it could forge a session cookie or read one. So the
 * variable is required, and a value too short to key A256GCM is rejected
 * rather than quietly padded — a secret that was set but does not take effect
 * is the failure mode that is hardest to notice.
 */
export const resolveAuthSecret = (): string => {
  const secret = process.env.PUBLIRA_AUTH_SECRET?.trim() ?? "";
  if (textEncoder.encode(secret).length < AES_GCM_KEY_BYTES) {
    throw new Error(
      `PUBLIRA_AUTH_SECRET is required and must be at least ${AES_GCM_KEY_BYTES} bytes`
    );
  }
  return secret;
};

export const buildBearerHeaders = (accessToken: string) =>
  ({
    headers: { Authorization: `Bearer ${accessToken}` },
  }) as never;

export const sessionCookieOptions = (expiresAt: Date) => ({
  expires: expiresAt,
  httpOnly: true as const,
  path: "/" as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
});
