import { CompactEncrypt, compactDecrypt } from "jose";

export interface WebSessionPayload {
  accessToken: string;
  expiresAt: string;
  name?: string;
  publicId?: string;
  role?: string;
  tenantId?: string;
}

/** A value `JSON.parse` can return. */
export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// A256GCM takes a 32-byte key, and the secret it is derived from is held to
// the same floor so the derived key never carries less entropy than it needs.
const AES_GCM_KEY_BYTES = 32;

/**
 * What a sealed value is for. Each purpose has a key of its own, so a value
 * sealed for one cookie does not open as another although every cookie of an
 * app is sealed under the same `PUBLIRA_AUTH_SECRET`.
 */
export type SealPurpose =
  | "mfa-challenge"
  | "pending-passkey-registration"
  | "pending-sign-up"
  | "session"
  | "sign-in-request";

// Synchronous, so an unusable secret throws at the call rather than as a
// rejected promise a caller could fold into "no payload".
const usableSecretBytes = (secret: string): Uint8Array<ArrayBuffer> => {
  const raw = textEncoder.encode(secret);

  if (raw.length < AES_GCM_KEY_BYTES) {
    throw new Error(
      `PUBLIRA_AUTH_SECRET must be at least ${AES_GCM_KEY_BYTES} bytes`
    );
  }

  return raw;
};

/**
 * The A256GCM key for one purpose, derived with HKDF-SHA-256 from every byte
 * of the secret, so changing any part of the secret changes every key.
 */
const deriveKey = async (
  secretBytes: Uint8Array<ArrayBuffer>,
  purpose: SealPurpose
): Promise<Uint8Array> => {
  const material = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    "HKDF",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      info: textEncoder.encode(`publira web-session ${purpose}`),
      name: "HKDF",
      salt: new Uint8Array(0),
    },
    material,
    AES_GCM_KEY_BYTES * 8
  );

  return new Uint8Array(bits);
};

/**
 * Seal an arbitrary JSON payload with the deployment's session key.
 *
 * The session cookie is not the only thing a console hands back to itself
 * through the browser: web-admin also carries the half-finished login an MFA
 * challenge stands for. Both want the same "the browser may hold it but
 * neither read nor forge it" property, so the sealing lives here once and
 * each cookie owns the payload shape it needs and names its purpose.
 */
export const encryptPayload = <TPayload>(
  payload: TPayload,
  secret: string,
  purpose: SealPurpose
): Promise<string> => {
  const secretBytes = usableSecretBytes(secret);

  return deriveKey(secretBytes, purpose).then((key) =>
    new CompactEncrypt(textEncoder.encode(JSON.stringify(payload)))
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .encrypt(key)
  );
};

/**
 * Open a payload sealed by {@link encryptPayload} for the same purpose, or
 * `null` when the value is not one this deployment sealed for it.
 *
 * The result is any JSON value on purpose: a cookie is untrusted input even
 * once it decrypts, so the caller validates the shape it expects.
 */
export const decryptPayload = async (
  token: string,
  secret: string,
  purpose: SealPurpose
): Promise<JsonValue> => {
  // Outside the try: an unusable key is a misconfigured deployment, and
  // reporting it as "no session" would send every visitor to the login screen.
  const key = await deriveKey(usableSecretBytes(secret), purpose);

  try {
    const { plaintext } = await compactDecrypt(token, key);
    const payload: JsonValue = JSON.parse(textDecoder.decode(plaintext));

    return payload;
  } catch {
    return null;
  }
};

export const encryptSessionPayload = (
  payload: WebSessionPayload,
  secret: string
): Promise<string> => encryptPayload(payload, secret, "session");

const isWebSessionPayload = (
  payload: JsonValue
): payload is WebSessionPayload & { [key: string]: JsonValue } =>
  payload !== null &&
  typeof payload === "object" &&
  !Array.isArray(payload) &&
  typeof payload.accessToken === "string" &&
  payload.accessToken !== "" &&
  typeof payload.expiresAt === "string" &&
  payload.expiresAt !== "";

export const decryptSessionPayload = async (
  token: string,
  secret: string
): Promise<WebSessionPayload | null> => {
  const payload = await decryptPayload(token, secret, "session");

  return isWebSessionPayload(payload) ? payload : null;
};

export const isSessionExpired = (
  expiresAt: string,
  now: number = Date.now()
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
 * variable is required, and a value shorter than the A256GCM key derived from
 * it is rejected rather than quietly stretched — a secret that was set but
 * does not take effect is the failure mode that is hardest to notice.
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

export const buildBearerHeaders = (accessToken: string) => ({
  headers: { Authorization: `Bearer ${accessToken}` },
});

/** The attributes {@link sessionCookieOptions} writes a session cookie with. */
interface SessionCookieOptions {
  expires: Date;
  httpOnly: true;
  path: "/";
  sameSite: "lax";
  secure: boolean;
}

export const sessionCookieOptions = (
  expiresAt: Date
): SessionCookieOptions => ({
  expires: expiresAt,
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
});

/**
 * The login device token the API issues on every sign-in whose password was
 * right. A later password sign-in that presents it counts against an allowance
 * of this browser's own, so strangers failing against the same address cannot
 * lock its owner out of a browser they have signed in from before.
 */
export interface LoginDevice {
  expiresAt: Temporal.Instant;
  token: string;
}

/**
 * The device a `Login` response carries, or `null` when there is none to keep:
 * a server that issues none, an empty token, or an expiry that is not an
 * instant.
 */
export const toLoginDevice = (
  device: { expiresAt: string; token: string } | undefined
): LoginDevice | null => {
  const token = device?.token.trim() ?? "";
  const expiresAt = device?.expiresAt.trim() ?? "";

  if (!(token && expiresAt)) {
    return null;
  }

  try {
    return { expiresAt: Temporal.Instant.from(expiresAt), token };
  } catch {
    return null;
  }
};

/** What {@link loginDeviceCookie} hands to `cookies().set()`. */
interface LoginDeviceCookie extends SessionCookieOptions {
  name: string;
  value: string;
}

/**
 * The cookie a browser keeps its login device token in, with the session
 * cookie's attributes and the device's own expiry.
 *
 * The token goes in as the API issued it: the API verifies it and treats one
 * it cannot as absent, so there is nothing to seal. It is a cookie of its own
 * because it has to outlive the session — signing out, and a session that
 * expires, leave it in place.
 */
export const loginDeviceCookie = (
  name: string,
  device: LoginDevice
): LoginDeviceCookie => ({
  ...sessionCookieOptions(new Date(device.expiresAt.epochMilliseconds)),
  name,
  value: device.token,
});
