import { guardPlaceholder } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getTenantSiteInfo } from "#lib/tenant";

export const metadata: Metadata = {
  title: "再設定メール送信",
};

const pickFirstQueryParam = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value.at(0);
  }
  return value;
};

const ResetPasswordRequestedContent = async ({
  params,
  searchParams,
}: {
  params: Promise<{ tenant_public_id: string }>;
  searchParams: Promise<{ email?: string | string[] }>;
}) => {
  await connection();

  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const info = await getTenantSiteInfo(tenant_public_id);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteTagline = info?.siteTagline?.trim();

  const sp = await searchParams;
  const email = pickFirstQueryParam(sp.email)?.trim();

  return (
    <>
      <header className="text-center">
        <TenantDocumentTitle
          pageTitle="再設定メール送信"
          siteLabel={siteLabel}
        />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </header>

      <section className="space-y-3 text-sm leading-6">
        <p>
          再設定メールを送信しました。メール内のリンクを開いて新しいパスワードを設定してください。
        </p>
        {email ? (
          <p className="text-muted-foreground">送信先: {email}</p>
        ) : null}
        <p className="text-muted-foreground">
          メールが届かない場合は、迷惑メールフォルダもご確認ください。
        </p>
      </section>

      <div className="text-center text-sm">
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          ログイン画面へ戻る
        </Link>
      </div>
    </>
  );
};

const ResetPasswordRequestedFallback = () => (
  <>
    <header className="text-center">
      <h1 className="font-serif text-2xl font-semibold">サイト</h1>
    </header>
    <section className="space-y-3 text-sm leading-6">
      <p>再設定メールの情報を読み込んでいます...</p>
    </section>
    <div className="text-center text-sm">
      <Link href="/login" className="font-medium text-primary hover:underline">
        ログイン画面へ戻る
      </Link>
    </div>
  </>
);

export default function ResetPasswordRequestedPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant_public_id: string }>;
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <Suspense fallback={<ResetPasswordRequestedFallback />}>
          <ResetPasswordRequestedContent
            params={params}
            searchParams={searchParams}
          />
        </Suspense>
      </div>
    </main>
  );
}
