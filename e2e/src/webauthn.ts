import type { Page } from "@playwright/test";

/**
 * Give `page` a platform authenticator that answers every WebAuthn prompt by
 * itself, as a device's screen lock does once its owner has unlocked it.
 *
 * It is Chromium's virtual authenticator, reached over CDP, so it lives as
 * long as the page does: clearing the context's cookies to sign out leaves the
 * passkeys it holds in place for the next sign-in on the same page. It
 * verifies its user and keeps discoverable credentials, which is what the
 * relying parties under test ask of a passkey.
 */
export const addVirtualAuthenticator = async (page: Page): Promise<void> => {
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable");
  await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      automaticPresenceSimulation: true,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      protocol: "ctap2",
      transport: "internal",
    },
  });
};
