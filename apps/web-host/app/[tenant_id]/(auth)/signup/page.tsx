import type { Metadata } from "next";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getTenantSiteInfo } from "#lib/tenant";

import { SignupForm } from "./_components/signup-form";
import { getTenantId } from "#lib/tenant-id";

export const metadata: Metadata = {
  title: "新規登録",
};

const SignupPageContent = async ({
  params,
}: PageProps<"/[tenant_id]/signup">) => {
  const tenantId = await getTenantId();

  const info = await getTenantSiteInfo(tenantId);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteTagline = info?.siteTagline?.trim();

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <TenantDocumentTitle pageTitle="新規登録" siteLabel={siteLabel} />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </div>

      <SignupForm />
    </div>
  );
};

const SignupPageFallback = () => (
  <div className="w-full max-w-sm">
    <div className="mb-8 text-center">
      <h1 className="font-serif text-2xl font-semibold">サイト</h1>
    </div>
    <SignupForm />
  </div>
);

export default function SignupPage({
  params,
}: PageProps<"/[tenant_id]/signup">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Suspense fallback={<SignupPageFallback />}>
        <SignupPageContent params={params} searchParams={Promise.resolve({})} />
      </Suspense>
    </main>
  );
}
