import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { verifyPublicEmail } from "#lib/auth";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { parseVerifySearchParams } from "./_lib/search-params";

export const metadata: Metadata = {
  title: "メール確認",
};

const VerificationResult = async ({ token }: { token: string }) => {
  const tenantId = await getTenantId();
  if (!token) {
    return (
      <>
        <section className="space-y-3 text-sm leading-6">
          <p>確認リンクが無効です。</p>
        </section>
        <div className="text-center text-sm">
          <LocaleLink
            href="/signup"
            className="font-medium text-primary hover:underline"
          >
            新規登録へ戻る
          </LocaleLink>
        </div>
      </>
    );
  }

  const verified = await verifyPublicEmail(token, tenantId);
  const message = verified
    ? "メールアドレスの確認が完了しました。ログインしてください。"
    : "確認に失敗しました。リンクの有効期限切れ、または無効なリンクの可能性があります。";

  return (
    <>
      <section className="space-y-3 text-sm leading-6">
        <p>{message}</p>
      </section>
      <div className="text-center text-sm">
        <LocaleLink
          href={verified ? "/login" : "/signup"}
          className="font-medium text-primary hover:underline"
        >
          {verified ? "ログイン画面へ" : "新規登録へ戻る"}
        </LocaleLink>
      </div>
    </>
  );
};

const VerificationFallback = () => (
  <>
    <header className="text-center">
      <h1 className="font-serif text-2xl font-semibold">サイト</h1>
    </header>
    <section className="space-y-3 text-sm leading-6">
      <p>確認処理を実行しています...</p>
    </section>
    <div className="text-center text-sm">
      <LocaleLink
        href="/signup"
        className="font-medium text-primary hover:underline"
      >
        新規登録へ戻る
      </LocaleLink>
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

  const tenantId = await getTenantId();

  const info = await getTenantSiteInfo(tenantId);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteTagline = info?.siteTagline?.trim();

  const { token } = parseVerifySearchParams(await searchParams);

  return (
    <>
      <header className="text-center">
        <TenantDocumentTitle pageTitle="メール確認" siteLabel={siteLabel} />
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
