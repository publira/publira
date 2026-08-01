import type { Metadata } from "next";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getTenantSiteInfo } from "#lib/tenant";

import { ResetPasswordForm } from "./_components/reset-password-form";
import { getTenantId } from "#lib/tenant-id";

export const metadata: Metadata = {
  title: "パスワード再設定",
};

const ResetPasswordPageContent = async ({
  params,
}: PageProps<"/[tenant_id]/reset-password">) => {
  const tenantId = await getTenantId();

  const info = await getTenantSiteInfo(tenantId);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteTagline = info?.siteTagline?.trim();

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <TenantDocumentTitle
          pageTitle="パスワード再設定"
          siteLabel={siteLabel}
        />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </div>

      <ResetPasswordForm />
    </div>
  );
};

const ResetPasswordPageFallback = () => (
  <div className="w-full max-w-sm">
    <div className="mb-8 text-center">
      <h1 className="font-serif text-2xl font-semibold">サイト</h1>
    </div>
    <ResetPasswordForm />
  </div>
);

export default function ResetPasswordPage({
  params,
  searchParams,
}: PageProps<"/[tenant_id]/reset-password">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Suspense fallback={<ResetPasswordPageFallback />}>
        <ResetPasswordPageContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
