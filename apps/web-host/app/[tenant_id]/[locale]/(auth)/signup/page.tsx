import { getMessage } from "@publira/i18n";
import { Skeleton } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { SignupForm } from "./_components/signup-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.auth.signup.title") };
};

const SignupPageContent = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [info, siteLabel, messages] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);
  const siteTagline = info?.siteTagline?.trim();

  return (
    <div className="mb-8 text-center">
      <TenantDocumentTitle
        pageTitle={getMessage(messages, "host.auth.signup.title")}
        siteLabel={siteLabel}
      />
      <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
      {siteTagline ? (
        <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
      ) : null}
    </div>
  );
};

const SignupPage = () => (
  <main className="flex min-h-dvh items-center justify-center px-4">
    <div className="w-full max-w-sm">
      <Suspense
        fallback={
          <div className="mb-8 flex justify-center">
            <Skeleton className="h-8 w-40" />
          </div>
        }
      >
        <SignupPageContent />
      </Suspense>

      <SignupForm />
    </div>
  </main>
);

export default SignupPage;
