import type { Locale } from "@publira/i18n";
import { NextResponse } from "next/server";

import { tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { listAllMyPurchases } from "#lib/purchases";
import { getTenantDefaultLocale, getTenantSupportedLocales } from "#lib/tenant";

import { renderPurchasesCsv } from "./_lib/purchases-csv";

/** Where a reader who has to sign in first is sent back to. */
const LIBRARY_PATH = "/my/library";

/**
 * The language the library linked from, named in the `locale` query: the
 * titles in the file are read in it, as the library lists them. A value the
 * tenant does not offer, or none at all, is the tenant's default language.
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
 * Every purchase the library lists for the signed-in reader, across all its
 * pages, as a CSV attachment linked from the library.
 *
 * A Route Handler has no locale segment, so the library names its language in
 * the query. A reader who has to sign in or agree to the tenant's terms first
 * is sent to that screen in that language, and comes back to the library
 * rather than to a download.
 */
export const GET = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/my/purchases/csv">
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
    LIBRARY_PATH,
    tenantId
  );
  const purchases = await withPublicSessionReauth(
    locale,
    LIBRARY_PATH,
    () => listAllMyPurchases(tenantId, accessToken, locale),
    tenantId
  );

  return new NextResponse(renderPurchasesCsv(purchases), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'attachment; filename="purchases.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
};
