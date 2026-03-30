import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { verifyPublicEmail } from "../../../lib/auth";
import { getTenantSiteInfo, getTenantSiteLabel } from "../../../lib/tenant";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ tenant_public_id: string }>;
}): Promise<Metadata> => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const siteLabel = await getTenantSiteLabel(tenant_public_id);

  return {
    title: `メール確認 | ${siteLabel}`,
  };
};

const pickFirstQueryParam = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value.at(0);
  }
  return value;
};

const VerificationResult = async ({
  tenantPublicId,
  token,
}: {
  tenantPublicId: string;
  token: string;
}) => {
  if (!token) {
    return (
      <>
        <section className="space-y-3 text-sm leading-6">
          <p>確認リンクが無効です。</p>
        </section>
        <div className="text-center text-sm">
          <Link
            href="/signup"
            className="font-medium text-primary hover:underline"
          >
            新規登録へ戻る
          </Link>
        </div>
      </>
    );
  }

  const verified = await verifyPublicEmail(token, tenantPublicId);
  const message = verified
    ? "メールアドレスの確認が完了しました。ログインしてください。"
    : "確認に失敗しました。リンクの有効期限切れ、または無効なリンクの可能性があります。";

  return (
    <>
      <section className="space-y-3 text-sm leading-6">
        <p>{message}</p>
      </section>
      <div className="text-center text-sm">
        <Link
          href={verified ? "/login" : "/signup"}
          className="font-medium text-primary hover:underline"
        >
          {verified ? "ログイン画面へ" : "新規登録へ戻る"}
        </Link>
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
      <Link href="/signup" className="font-medium text-primary hover:underline">
        新規登録へ戻る
      </Link>
    </div>
  </>
);

const VerifyPageContent = async ({
  params,
  searchParams,
}: {
  params: Promise<{ tenant_public_id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const info = await getTenantSiteInfo(tenant_public_id);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteTagline = info?.siteTagline?.trim();

  const sp = await searchParams;
  const token = pickFirstQueryParam(sp.token)?.trim() ?? "";

  return (
    <>
      <header className="text-center">
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </header>

      <VerificationResult tenantPublicId={tenant_public_id} token={token} />
    </>
  );
};

export default function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant_public_id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <Suspense fallback={<VerificationFallback />}>
          <VerifyPageContent params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
