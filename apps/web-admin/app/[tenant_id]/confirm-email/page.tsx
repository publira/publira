import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { confirmAdminEmailChange } from "#lib/admin-auth";
import { getTenantId } from "#lib/tenant-id";

export const metadata: Metadata = {
  title: "メールアドレス変更確認",
};

interface ConfirmEmailPageProps {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{
    token?: string;
  }>;
}

const ConfirmationResult = async ({ token }: { token: string }) => {
  const tenantId = await getTenantId();
  if (!token) {
    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="destructive">確認リンクが無効です。</FormMessage>
        <p className="text-sm text-muted-foreground">
          メールアドレス変更を再度リクエストしてください。
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <LinkButton className="flex-1" render={<Link href="/login" />}>
            ログイン画面へ
          </LinkButton>
        </div>
      </div>
    );
  }

  const result = await confirmAdminEmailChange(tenantId, token);

  if (!result) {
    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="destructive">
          メールアドレスの変更に失敗しました。リンクの有効期限切れ、または無効なリンクの可能性があります。
        </FormMessage>
        <p className="text-sm text-muted-foreground">
          メールアドレス変更を再度リクエストしてください。
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <LinkButton className="flex-1" render={<Link href="/login" />}>
            ログイン画面へ
          </LinkButton>
        </div>
      </div>
    );
  }

  if (result.changed) {
    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="success">
          メールアドレスの変更が完了しました。
        </FormMessage>
        <p className="text-sm text-muted-foreground">
          新しいメールアドレスでログインできます。
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <LinkButton className="flex-1" render={<Link href="/login" />}>
            ログイン画面へ
          </LinkButton>
        </div>
      </div>
    );
  }

  if (result.confirmed) {
    const pendingMessage =
      result.pendingConfirmationFor === "current_email"
        ? "この確認は完了しました。現在のメールアドレス側の確認が完了すると変更が反映されます。"
        : "この確認は完了しました。新しいメールアドレス側の確認が完了すると変更が反映されます。";

    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="success">確認が完了しました。</FormMessage>
        <p className="text-sm text-muted-foreground">{pendingMessage}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <LinkButton className="flex-1" render={<Link href="/login" />}>
            ログイン画面へ
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <FormMessage variant="destructive">
        メールアドレスの変更に失敗しました。
      </FormMessage>
      <p className="text-sm text-muted-foreground">
        メールアドレス変更を再度リクエストしてください。
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <LinkButton className="flex-1" render={<Link href="/login" />}>
          ログイン画面へ
        </LinkButton>
      </div>
    </div>
  );
};

const ConfirmEmailFallback = () => (
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <div className="h-5 animate-pulse rounded bg-muted/70" />
    <div className="h-5 animate-pulse rounded bg-muted/70" />
    <div className="h-10 animate-pulse rounded bg-muted" />
  </div>
);

const ConfirmEmailPageContent = async ({
  searchParams,
}: ConfirmEmailPageProps) => {
  const sp = await searchParams;
  const token = sp.token?.trim() ?? "";

  return <ConfirmationResult token={token} />;
};

const ConfirmEmailPage = ({ params, searchParams }: ConfirmEmailPageProps) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-serif text-2xl font-semibold">
          メールアドレス変更確認
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          メールアドレス変更の確認を処理しています。
        </p>
      </div>

      <Suspense fallback={<ConfirmEmailFallback />}>
        <ConfirmEmailPageContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default ConfirmEmailPage;
