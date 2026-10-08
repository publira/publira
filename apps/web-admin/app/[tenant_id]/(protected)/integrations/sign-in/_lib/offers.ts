import type { TenantSignInSettings } from "#lib/tenant-sign-in-settings";

/** Where a reader meets a provider's button. */
export type SignInSurface = "android" | "ios" | "site";

export interface SignInOffer {
  surface: SignInSurface;
  offered: boolean;
}

/** Each provider's surfaces, in the order the console lists them. */
export interface SignInOffers {
  apple: SignInOffer[];
  google: SignInOffer[];
}

/**
 * Where the saved settings show each provider's button. A provider that is
 * ready may still be missing from the site: readiness counts every client
 * together, while each surface signs in with a client of its own.
 *
 * This repeats the conditions the clients apply rather than inventing its own:
 * the storefront offers a provider through its Services ID or Web client ID
 * (`getTenantSignInClients` in web-host), and the app through the clients
 * `offeredProviders` in `mobile/lib/auth/provider_sign_in.dart` picks for its
 * platform. Neither is reachable from here, so a change to one of them changes
 * this as well.
 *
 * `androidApplicationId` is the Android app named under App links, empty where
 * none is named and absent where that read failed, which leaves Apple's
 * Android row out rather than state it wrongly.
 */
export const signInOffers = (
  { apple, google }: TenantSignInSettings,
  androidApplicationId?: string
): SignInOffers => {
  const appleWeb = apple.ready && apple.servicesId !== "";
  const appleIos = apple.ready && apple.bundleIdentifier !== "";
  const googleWeb = google.ready && google.webClientId !== "";
  return {
    apple: [
      { offered: appleWeb, surface: "site" },
      { offered: appleIos, surface: "ios" },
      ...(androidApplicationId === undefined
        ? []
        : [
            {
              offered: appleWeb && androidApplicationId !== "",
              surface: "android" as const,
            },
          ]),
    ],
    google: [
      { offered: googleWeb, surface: "site" },
      // The App Store requires Apple beside any other third-party sign-in, so
      // the iOS app shows Google only where it shows Apple. The app also has
      // to be built with this client, which the console cannot see.
      {
        offered: google.ready && google.iosClientId !== "" && appleIos,
        surface: "ios",
      },
      // The Android app signs in to Google with the web client as its server
      // client ID.
      { offered: googleWeb, surface: "android" },
    ],
  };
};
