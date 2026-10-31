import type { Locale } from "@publira/i18n";

import { tenantLocalePath } from "#lib/tenant-locale-path";

/** Where the security settings' Actions send the reader back to. */
export const SECURITY_SETTINGS_RETURN_TO = "/settings/security";

/**
 * The security settings with an Action's flash message.
 *
 * The locale is a parameter because Actions cannot read `next/root-params`;
 * it comes from the form's hidden field.
 */
export const buildSecuritySettingsPath = async (
  locale: Locale,
  tenantId: string,
  status: "success" | "error",
  message: string
): Promise<string> => {
  const params = new URLSearchParams({ message, status });

  const path = await tenantLocalePath(
    tenantId,
    locale,
    SECURITY_SETTINGS_RETURN_TO
  );

  return `${path}?${params.toString()}`;
};
