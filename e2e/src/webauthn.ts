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

/**
 * Make `page` a browser that offers passkeys from a button alone, without
 * listing them in the autofill of a form field.
 *
 * The virtual authenticator answers an autofill (conditional mediation)
 * request by itself as soon as it holds a passkey for the site, so on a page
 * that asks for one on load the reader is signed in before a click can reach
 * the page's button. Reporting autofill as unsupported, as a browser without
 * it does, leaves the button the only way in. Call it before the page loads.
 */
export const withoutPasskeyAutofill = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = () =>
      Promise.resolve(false);
  });
};
