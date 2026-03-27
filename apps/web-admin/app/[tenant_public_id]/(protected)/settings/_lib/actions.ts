"use server";

import { updateTenantSiteSettings } from "../../../../../lib/site-settings";
import type { SiteSettingsActionState } from "../settings-types";

export const updateSiteSettingsAction = async (
  _prevState: SiteSettingsActionState,
  formData: FormData
): Promise<SiteSettingsActionState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const copyrightText = String(formData.get("copyright_text") ?? "");
  const siteDescription = String(formData.get("site_description") ?? "");
  const siteTagline = String(formData.get("site_tagline") ?? "");

  if (!tenantPublicId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }

  const result = await updateTenantSiteSettings({
    copyrightText,
    siteDescription,
    siteTagline,
    tenantPublicId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  return {
    message: "設定を保存しました。",
    ok: true,
  };
};
