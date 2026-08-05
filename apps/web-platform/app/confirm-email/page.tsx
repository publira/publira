import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { confirmPlatformEmailChange } from "#lib/email-change";

export const metadata: Metadata = {
  title: "メールアドレス変更確認",
};

const pickFirstQueryParam = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value.at(0);
  }
  return value;
};

const ConfirmationResult = async ({ token }: { token: string }) => {
  if (!token) {
    return (
      <>
        <section className="space-y-3 text-sm leading-6">
          <p>確認リンクが無効です。</p>
        </section>
        <div className="text-center text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href="/settings/account"
          >
            設定へ戻る
          </Link>
        </div>
      </>
    );
  }

  const result = await confirmPlatformEmailChange(token);
  let message =
    "メールアドレスの変更に失敗しました。リンクの有効期限切れ、または無効なリンクの可能性があります。";

  if (result) {
    if (result.changed) {
      message = "メールアドレスの変更が完了しました。";
    } else if (result.confirmed) {
      message =
        result.pendingConfirmationFor === "current_email"
          ? "この確認は完了しました。現在のメールアドレス側の確認が完了すると変更が反映されます。"
          : "この確認は完了しました。新しいメールアドレス側の確認が完了すると変更が反映されます。";
    }
  }

  return (
    <>
      <section className="space-y-3 text-sm leading-6">
        <p>{message}</p>
      </section>
      <div className="text-center text-sm">
        <Link
          className="font-medium text-primary hover:underline"
          href={result?.changed ? "/" : "/settings/account"}
        >
          {result?.changed ? "ダッシュボードへ" : "設定へ戻る"}
        </Link>
      </div>
    </>
  );
};

const ConfirmationFallback = () => (
  <>
    <header className="text-center">
      <h1 className="font-serif text-2xl font-semibold">Publira</h1>
      <p className="mt-2 text-sm text-muted-foreground">Platform Console</p>
    </header>
    <section className="space-y-3 text-sm leading-6">
      <p>確認処理を実行しています...</p>
    </section>
    <div className="text-center text-sm">
      <Link
        className="font-medium text-primary hover:underline"
        href="/settings/account"
      >
        設定へ戻る
      </Link>
    </div>
  </>
);

const ConfirmEmailPageContent = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  await connection();

  const sp = await searchParams;
  const token = pickFirstQueryParam(sp.token)?.trim() ?? "";

  return (
    <>
      <header className="text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          メールアドレス変更確認
        </p>
      </header>

      <ConfirmationResult token={token} />
    </>
  );
};

const ConfirmEmailPage = ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <Suspense fallback={<ConfirmationFallback />}>
        <ConfirmEmailPageContent searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default ConfirmEmailPage;
