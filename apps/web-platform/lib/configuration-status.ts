import type { Locale } from "@publira/i18n";

import { getPlatformEmailSettings } from "./email-settings";
import type { PlatformSmtpSettings } from "./email-settings-shared";
import { getPlatformStorageSettings } from "./storage-settings";
import type { PlatformStorageSettings } from "./storage-settings-shared";
import type { PlatformWebPushSettings } from "./webpush-settings";

/**
 * Where one area of the installation stands. Only `needs_setup` asks the
 * operator to act; an optional integration left off and a policy on its
 * built-in values are both states an installation can run in.
 */
export type ConfigurationState =
  | "configured"
  | "defaults"
  | "needs_setup"
  | "not_configured";

/**
 * A save validates every SMTP field but the password, and the outbox refuses
 * every message while none is stored.
 */
export const emailConfigurationState = (
  settings: Pick<PlatformSmtpSettings, "hasPassword" | "host">
): ConfigurationState =>
  settings.host.trim() && settings.hasPassword ? "configured" : "needs_setup";

/** Revision `"0"` is the row a fresh installation has not saved yet. */
export const storageConfigurationState = (
  settings: Pick<PlatformStorageSettings, "revision">
): ConfigurationState =>
  settings.revision === "0" ? "needs_setup" : "configured";

export const webPushConfigurationState = (
  settings: Pick<PlatformWebPushSettings, "configured">
): ConfigurationState =>
  settings.configured ? "configured" : "not_configured";

/** Each policy row reports revision `"0"` while its built-in values apply. */
export const policyConfigurationState = (
  revisions: readonly string[]
): ConfigurationState =>
  revisions.every((revision) => revision === "0") ? "defaults" : "configured";

/** `unknown` when a read failed, which the screen reports on its own. */
export type RequiredConfigurationState = "needs_setup" | "ready" | "unknown";

/**
 * Whether email and storage, the two settings the platform cannot work
 * without, are both saved. A rejected session is left to the caller's own
 * reads, which raise the login redirect.
 */
export const getRequiredConfigurationState = async (
  locale: Locale
): Promise<RequiredConfigurationState> => {
  const [email, storage] = await Promise.all([
    getPlatformEmailSettings(locale),
    getPlatformStorageSettings(locale),
  ]);

  if (
    (email.ok && emailConfigurationState(email.settings) === "needs_setup") ||
    (storage.ok &&
      storageConfigurationState(storage.settings) === "needs_setup")
  ) {
    return "needs_setup";
  }
  return email.ok && storage.ok ? "ready" : "unknown";
};
