import { getMessage } from "@publira/i18n";
import { Skeleton } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { ResendVerificationForm } from "./_components/resend-verification-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.auth.resend_verification.title") };
};

const ResendVerificationHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [info, siteLabel, messages] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);
  const siteTagline = info?.siteTagline?.trim();

  return (
    <>
      <TenantDocumentTitle
        pageTitle={getMessage(messages, "host.auth.resend_verification.title")}
        siteLabel={siteLabel}
      />
      <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
      {siteTagline ? (
        <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
      ) : null}
    </>
  );
};

const ResendVerificationPage = () => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <Suspense
          fallback={
            <div className="flex justify-center">
              <Skeleton className="h-8 w-40" />
            </div>
          }
        >
          <ResendVerificationHeader />
        </Suspense>
      </div>

      <ResendVerificationForm />
    </div>
  </main>
);

export default ResendVerificationPage;
