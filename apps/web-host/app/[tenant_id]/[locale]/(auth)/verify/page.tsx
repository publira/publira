import { getMessage } from "@publira/i18n";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { verifyPublicEmail } from "#lib/auth";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { parseVerifySearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.auth.verify.title") };
};

/**
 * What a confirmation link did, and where it leaves the reader.
 *
 * A link that did not work sends them to `/resend-verification` rather than
 * back to sign-up: the account behind an expired link already exists, so
 * signing up again creates nothing, and it cannot be signed into or reset
 * until the address is confirmed.
 */
const VerificationResult = async ({ token }: { token: string }) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const messages = await loadHostMessages(locale);

  if (!token) {
    return (
      <>
        <section className="space-y-3 text-sm leading-6">
          <p>{getMessage(messages, "host.auth.fields.invalid_token")}</p>
        </section>
        <div className="text-center text-sm">
          <LocaleLink
            href="/resend-verification"
            className="font-medium text-primary hover:underline"
          >
            {getMessage(messages, "host.auth.verify.to_resend_verification")}
          </LocaleLink>
        </div>
      </>
    );
  }

  const verified = await verifyPublicEmail(token, tenantId);

  return (
    <>
      <section className="space-y-3 text-sm leading-6">
        <p>
          {getMessage(
            messages,
            verified ? "host.auth.verify.verified" : "host.auth.verify.failed"
          )}
        </p>
      </section>
      <div className="text-center text-sm">
        <LocaleLink
          href={verified ? "/login" : "/resend-verification"}
          className="font-medium text-primary hover:underline"
        >
          {getMessage(
            messages,
            verified
              ? "host.auth.verify.to_login"
              : "host.auth.verify.to_resend_verification"
          )}
        </LocaleLink>
      </div>
    </>
  );
};

const VerificationFallback = () => (
  <>
    <header className="flex justify-center">
      <Skeleton className="h-8 w-40" />
    </header>
    <section className="space-y-3">
      <SkeletonLine className="h-4 w-full" />
      <SkeletonLine className="h-4 w-3/4" />
    </section>
    <div className="flex justify-center">
      <SkeletonLine className="h-4 w-28" />
    </div>
  </>
);

const VerifyPageContent = async ({
  searchParams,
}: {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  await connection();

  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [info, siteLabel, messages] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);
  const siteTagline = info?.siteTagline?.trim();

  const { token } = parseVerifySearchParams(await searchParams);

  return (
    <>
      <header className="text-center">
        <TenantDocumentTitle
          pageTitle={getMessage(messages, "host.auth.verify.title")}
          siteLabel={siteLabel}
        />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </header>

      <VerificationResult token={token} />
    </>
  );
};

const VerifyPage = ({
  params,
  searchParams,
}: {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <Suspense fallback={<VerificationFallback />}>
        <VerifyPageContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default VerifyPage;
