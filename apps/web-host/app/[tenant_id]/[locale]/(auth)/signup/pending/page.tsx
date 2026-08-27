import type { Metadata } from "next";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import {
  readEmailFlashCookie,
  SIGNUP_PENDING_EMAIL_COOKIE,
} from "#lib/email-flash-cookie";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

export const metadata: Metadata = {
  title: "メール確認待ち",
};

const SignupPendingContent = async () => {
  const tenantId = await getTenantId();

  const info = await getTenantSiteInfo(tenantId);
  const siteLabel = info?.name.trim() || "サイト";
  const siteTagline = info?.siteTagline?.trim();

  const email = await readEmailFlashCookie(SIGNUP_PENDING_EMAIL_COOKIE);

  return (
    <>
      <header className="text-center">
        <TenantDocumentTitle pageTitle="メール確認待ち" siteLabel={siteLabel} />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </header>

      <section className="space-y-3 text-sm leading-6">
        <p>
          確認メールを送信しました。メール内のリンクを開いて登録を完了してください。
        </p>
        {email ? (
          <p className="text-muted-foreground">送信先: {email}</p>
        ) : null}
        <p className="text-muted-foreground">
          メールが届かない場合は、迷惑メールフォルダもご確認ください。
        </p>
      </section>

      <div className="text-center text-sm">
        <LocaleLink
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          ログイン画面へ戻る
        </LocaleLink>
      </div>
    </>
  );
};

const SignupPendingFallback = () => (
  <>
    <header className="text-center">
      <h1 className="font-serif text-2xl font-semibold">サイト</h1>
    </header>
    <section className="space-y-3 text-sm leading-6">
      <p>確認メール情報を読み込んでいます...</p>
    </section>
    <div className="text-center text-sm">
      <LocaleLink
        href="/login"
        className="font-medium text-primary hover:underline"
      >
        ログイン画面へ戻る
      </LocaleLink>
    </div>
  </>
);

const SignupPendingPage = () => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <Suspense fallback={<SignupPendingFallback />}>
        <SignupPendingContent />
      </Suspense>
    </div>
  </main>
);

export default SignupPendingPage;
