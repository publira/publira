import { CompactEncrypt, compactDecrypt } from "jose";

export interface WebSessionPayload {
  accessToken: string;
  expiresAt: string;
  name?: string;
  publicId?: string;
  role?: string;
  tenantPublicId?: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toAesGcmKeyBytes = (secret: string): Uint8Array => {
  const raw = textEncoder.encode(secret);
  if (raw.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 bytes");
  }
  // A256GCM requires exactly 32 bytes
  return raw.slice(0, 32);
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
  try {
    const key = toAesGcmKeyBytes(secret);
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

export const resolveAuthSecret = (): string => {
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  if (secret.length >= 32) {
    return secret;
  }
  // Dev/test fallback (must be >= 32 bytes)
  return "publira-dev-web-auth-secret-32b!!";
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
