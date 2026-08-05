import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "再設定メール送信完了",
};

const pickFirstQueryParam = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value.at(0);
  }
  return value;
};

const RequestedContent = async ({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) => {
  await connection();

  const sp = await searchParams;
  const email = pickFirstQueryParam(sp.email)?.trim();

  return (
    <>
      <header className="text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          再設定メール送信完了
        </p>
      </header>

      <section className="space-y-3 text-sm leading-6">
        <FormMessage variant="success">
          メールアドレスが登録されている場合、パスワード再設定メールを送信しました。
        </FormMessage>
        {email ? (
          <p className="text-muted-foreground">送信先: {email}</p>
        ) : null}
        <p className="text-muted-foreground">
          メール内のリンクから新しいパスワードを設定してください。届かない場合は、迷惑メールフォルダもご確認ください。
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <LinkButton className="flex-1" render={<Link href="/login" />}>
          ログイン画面へ戻る
        </LinkButton>
        <LinkButton
          className="flex-1"
          render={<Link href="/reset-password" />}
          variant="outline"
        >
          別のメールアドレスで試す
        </LinkButton>
      </div>
    </>
  );
};

const RequestedFallback = () => (
  <>
    <header className="text-center">
      <h1 className="font-serif text-2xl font-semibold">Publira</h1>
      <p className="mt-2 text-sm text-muted-foreground">再設定メール送信完了</p>
    </header>
    <section className="space-y-3 text-sm leading-6">
      <p>情報を読み込んでいます...</p>
    </section>
    <div className="text-center text-sm">
      <Link className="font-medium text-primary hover:underline" href="/login">
        ログイン画面へ戻る
      </Link>
    </div>
  </>
);

const ResetPasswordRequestedPage = ({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <Suspense fallback={<RequestedFallback />}>
        <RequestedContent searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default ResetPasswordRequestedPage;
