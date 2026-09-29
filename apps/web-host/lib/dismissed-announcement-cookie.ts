import { profileCookieName } from "@publira/web-session/cookie-name";
import { cookies } from "next/headers";

/**
 * The announcement whose banner this browser has closed.
 *
 * It holds one id rather than a list: only the newest pinned announcement is
 * ever shown, so the moment an operator pins another one the stored id stops
 * matching and the band comes back — which is the behaviour a reader expects
 * from a new announcement, and what keeps the cookie from growing.
 *
 * A browser rather than an account is what carries it, so a reader who never
 * signed in can close the band too. It is `httpOnly` because only the server
 * ever reads it.
 */
export const DISMISSED_ANNOUNCEMENT_COOKIE = profileCookieName(
  "publira_web_host_dismissed_announcement"
);

/** A year: long enough that a closed banner stays closed for good in practice. */
const DISMISSED_ANNOUNCEMENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const readDismissedAnnouncementId = async (): Promise<string> => {
  const cookieStore = await cookies();
  return cookieStore.get(DISMISSED_ANNOUNCEMENT_COOKIE)?.value?.trim() ?? "";
};

export const setDismissedAnnouncementId = async (
  announcementId: string
): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.set({
    httpOnly: true,
    maxAge: DISMISSED_ANNOUNCEMENT_COOKIE_MAX_AGE_SECONDS,
    name: DISMISSED_ANNOUNCEMENT_COOKIE,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    value: announcementId,
  });
};
