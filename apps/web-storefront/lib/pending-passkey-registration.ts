/**
 * A passkey registration a fresh sign-in to Apple or Google confirmed, waiting
 * for the reader to create the passkey. The provider answers the sign-in with a
 * POST to the callback, which begins the registration, but only the page can
 * ask the browser for a passkey, and only once the reader presses a button
 * there. So the options the API answered with wait in a cookie sealed with the
 * session key until the security settings page offers them.
 */

import {
  decryptPayload,
  encryptPayload,
  resolveAuthSecret,
} from "@publira/web-session";
import { profileCookieName } from "@publira/web-session/cookie-name";
import { cookies } from "next/headers";
import { z } from "zod";

import { isTenantIdFormat } from "./tenant-id-format";

export const PENDING_PASSKEY_REGISTRATION_COOKIE_NAME = profileCookieName(
  "publira_web_storefront_passkey_registration"
);

/** The five minutes the API keeps the ceremony's challenge. */
const PENDING_PASSKEY_REGISTRATION_MAX_AGE_SECONDS = 300;

const pendingPasskeyRegistrationSchema = z.object({
  optionsJson: z.string().min(1),
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
 * The creation options waiting for `tenantId`, or `null` when none are. A
 * registration begun for another tenant on the same host is not offered.
 */
export const readPendingPasskeyRegistration = async (
  tenantId: string
): Promise<string | null> => {
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
    ? parsed.data.optionsJson
    : null;
};

/** Spend the waiting registration once its passkey is stored. */
export const clearPendingPasskeyRegistration = async (): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.delete({
    name: PENDING_PASSKEY_REGISTRATION_COOKIE_NAME,
    path: "/",
  });
};
