import type { BrandMarkKind } from "#lib/brand-marks";

/**
 * The owner's guideline page an administrator is shown, and accepts, before
 * uploading each mark. The upload records the URL the dialog showed, so
 * changing one here applies to the next acceptance and leaves the marks
 * already accepted under the old page as they were.
 */
export const BRAND_MARK_GUIDELINE_URLS: Record<BrandMarkKind, string> = {
  app_store_badge:
    "https://developer.apple.com/app-store/marketing/guidelines/",
  apple_sign_in:
    "https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple",
  google_play_badge: "https://play.google.com/intl/en_us/badges/",
  google_sign_in: "https://developers.google.com/identity/branding-guidelines",
  line_share: "https://www.line.me/en/logo",
  x_share: "https://about.x.com/en/who-we-are/brand-toolkit",
};
