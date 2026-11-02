import type { Locale } from "@publira/i18n";
import { NextResponse } from "next/server";
import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import {
  creatorIdParamSchema,
  creatorStatementHref,
  periodParamSchema,
} from "#lib/creator-page-paths";
import { getMyCreatorStatementExport } from "#lib/creator-pages";
import { getTenantDefaultLocale, getTenantSupportedLocales } from "#lib/tenant";

import { renderStatementCsv } from "./_lib/statement-csv";

const pathSchema = z.object({
  creator_id: creatorIdParamSchema,
  period: periodParamSchema,
  tenant_id: tenantIdSchema,
});

const notFound = () => new NextResponse("Not Found", { status: 404 });

/**
 * The language the statement linked from, named in the `locale` query, which
 * the sign-in screen is shown in when the session has to be renewed first. A
 * value the tenant does not offer, or none at all, is the tenant's default.
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
 * Every line of a closed month that credits the signed-in reader's Author, as
 * a CSV attachment linked from that month's statement.
 *
 * A reader who has to sign in or agree to the tenant's terms first comes back
 * to the statement rather than to a download, as the purchase history does.
 * An Author the account is not linked to, a month not closed, and a tenant
 * that shows no Author pages or hides their sales are all not found.
 */
export const GET = async (
  request: Request,
  {
    params,
  }: RouteContext<"/[tenant_id]/api/v1/my/creators/[creator_id]/statements/[period]/csv">
) => {
  const path = pathSchema.safeParse(await params);

  if (!path.success) {
    return notFound();
  }

  const { creator_id: creatorId, period, tenant_id: tenantId } = path.data;
  const locale = await downloadLocale(request, tenantId);
  const returnTo = creatorStatementHref(creatorId, period);

  const accessToken = await requirePublicSession(locale, returnTo, tenantId);

  const statement = await withPublicSessionReauth(
    locale,
    returnTo,
    () =>
      getMyCreatorStatementExport(tenantId, accessToken, { creatorId, period }),
    tenantId
  );

  if (!statement) {
    return notFound();
  }

  const fileName = `royalties-${statement.creator.publicId}-${period}.csv`;

  return new NextResponse(renderStatementCsv(statement), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
};
