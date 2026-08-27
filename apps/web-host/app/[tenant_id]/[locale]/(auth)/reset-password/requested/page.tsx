import type { Metadata } from "next";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import {
  readEmailFlashCookie,
  RESET_PASSWORD_REQUESTED_EMAIL_COOKIE,
} from "#lib/email-flash-cookie";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

export const metadata: Metadata = {
  title: "再設定メール送信",
};

const ResetPasswordRequestedContent = async () => {
  const tenantId = await getTenantId();

  const info = await getTenantSiteInfo(tenantId);
  const siteLabel = info?.name.trim() || "サイト";
  const siteTagline = info?.siteTagline?.trim();

  const email = await readEmailFlashCookie(
    RESET_PASSWORD_REQUESTED_EMAIL_COOKIE
  );

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

const ResetPasswordRequestedFallback = () => (
  <>
    <header className="text-center">
      <h1 className="font-serif text-2xl font-semibold">サイト</h1>
    </header>
    <section className="space-y-3 text-sm leading-6">
      <p>再設定メールの情報を読み込んでいます...</p>
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

const ResetPasswordRequestedPage = () => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <Suspense fallback={<ResetPasswordRequestedFallback />}>
        <ResetPasswordRequestedContent />
      </Suspense>
    </div>
  </main>
);

export default ResetPasswordRequestedPage;
