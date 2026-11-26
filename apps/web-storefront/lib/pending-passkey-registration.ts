/**
 * A fresh sign-in to Apple or Google that confirmed adding a passkey, waiting
 * for the reader to create it. The provider answers the sign-in with a POST to
 * the callback, but only the page can ask the browser for a passkey, and only
 * once the reader presses a button there. So the sign-in waits in a cookie
 * sealed with the session key, and the button begins the registration with it.
 *
 * The sign-in is what waits rather than the creation options the API answers
 * a registration with: those list every passkey the account holds already,
 * which can outgrow one cookie, while a sign-in's size does not depend on the
 * account.
 */

import {
  decryptPayload,
  encryptPayload,
  resolveAuthSecret,
} from "@publira/web-session";
import { profileCookieName } from "@publira/web-session/cookie-name";
import { cookies } from "next/headers";
import { z } from "zod";

import { SIGN_IN_PROVIDERS } from "./sign-in-provider";
import { isTenantIdFormat } from "./tenant-id-format";

export const PENDING_PASSKEY_REGISTRATION_COOKIE_NAME = profileCookieName(
  "publira_web_storefront_passkey_registration"
);

/**
 * Long enough to press the button once back on the page, short enough that a
 * page left open does not offer a sign-in long gone.
 */
const PENDING_PASSKEY_REGISTRATION_MAX_AGE_SECONDS = 300;

const pendingPasskeyRegistrationSchema = z.object({
  idToken: z.string().min(1),
  nonce: z.string().min(1),
  provider: z.enum(SIGN_IN_PROVIDERS),
  tenantId: z.string().refine(isTenantIdFormat),
});

export type PendingPasskeyRegistration = z.output<
  typeof pendingPasskeyRegistrationSchema
>;

export const writePendingPasskeyRegistration = async (
  pending: PendingPasskeyRegistration
): Promise<void> => {
  const sealed = await encryptPayload(pending, resolveAuthSecret());
  const cookieStore = await cookies();
  cookieStore.set({
    httpOnly: true,
    maxAge: PENDING_PASSKEY_REGISTRATION_MAX_AGE_SECONDS,
    name: PENDING_PASSKEY_REGISTRATION_COOKIE_NAME,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    value: sealed,
  });
};

/**
 * The sign-in waiting for `tenantId`, or `null` when none is. One made for
 * another tenant on the same host is not offered.
 */
export const readPendingPasskeyRegistration = async (
  tenantId: string
): Promise<PendingPasskeyRegistration | null> => {
  const cookieStore = await cookies();

  const raw = cookieStore
    .get(PENDING_PASSKEY_REGISTRATION_COOKIE_NAME)
    ?.value?.trim();

  if (!raw) {
    return null;
  }

  const parsed = pendingPasskeyRegistrationSchema.safeParse(
    await decryptPayload(raw, resolveAuthSecret())
  );

  return parsed.success && parsed.data.tenantId === tenantId
    ? parsed.data
    : null;
};

/** Spend the waiting sign-in, which confirms one registration at most. */
export const clearPendingPasskeyRegistration = async (): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.delete({
    name: PENDING_PASSKEY_REGISTRATION_COOKIE_NAME,
    path: "/",
  });
};
