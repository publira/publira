import type { Locale } from "@publira/i18n";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { openMyDataExport } from "#lib/data-export";
import { getMessagesFor } from "#lib/messages";
import { getTenantDefaultLocale, getTenantSupportedLocales } from "#lib/tenant";
import { tenantLocalePath } from "#lib/tenant-locale-path";

/** The section the download is linked from, and where a reader returns to. */
const SETTINGS_PATH = "/settings";

/**
 * The language the settings screen linked from, named in the `locale` query. A
 * value the tenant does not offer, or none at all, is the tenant's default
 * language.
 */
const downloadLocale = async (
  request: Request,
  tenantId: string
): Promise<Locale> => {
  const requested = new URL(request.url).searchParams.get("locale");
  const supportedLocales = await getTenantSupportedLocales(tenantId);

  return (
    supportedLocales.find((locale) => locale === requested) ??
    getTenantDefaultLocale(tenantId)
  );
};

/**
 * The signed-in reader's archive of their data, streamed from the API to the
 * browser as a ZIP attachment.
 *
 * The bucket the archive is kept in need not be reachable from a browser, so
 * the archive is read through `DownloadMyDataExport` rather than handed out as
 * a URL to the object. A reader who has to sign in first, or whose archive has
 * expired since the screen was drawn, is sent back to the settings screen in
 * the language it linked from.
 */
export const GET = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/my/data-export">
) => {
  const { tenant_id } = await params;
  const tenant = tenantIdSchema.safeParse(tenant_id);

  if (!tenant.success) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const tenantId = tenant.data;
  const locale = await downloadLocale(request, tenantId);

  const accessToken = await requirePublicSession(
    locale,
    SETTINGS_PATH,
    tenantId
  );

  const archive = await withPublicSessionReauth(
    locale,
    SETTINGS_PATH,
    () => openMyDataExport(tenantId, accessToken),
    tenantId
  );

  if (!archive) {
    const [t, settingsPath] = await Promise.all([
      getMessagesFor(locale),
      tenantLocalePath(tenantId, locale, SETTINGS_PATH),
    ]);

    const flash = new URLSearchParams({
      message: t("storefront.settings.data_export_gone"),
      status: "error",
    });

    redirect(`${settingsPath}?${flash.toString()}`);
  }

  return new NextResponse(archive, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'attachment; filename="data-export.zip"',
      "Content-Type": "application/zip",
    },
  });
};
