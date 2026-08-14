import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { confirmPasswordAction } from "./_lib/actions";
import { parseConfirmPasswordSearchParams } from "./_lib/search-params";

export const metadata: Metadata = {
  title: "新しいパスワードの設定",
};

const FailureState = ({ status }: { status: "expired" | "invalid" }) => {
  const message =
    status === "expired"
      ? "この再設定リンクは有効期限が切れています。"
      : "この再設定リンクは無効です。";

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <FormMessage variant="destructive">{message}</FormMessage>
      <p className="text-sm text-muted-foreground">
        もう一度メール送信からやり直すと、新しい再設定リンクを受け取れます。
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <LinkButton className="flex-1" render={<Link href="/reset-password" />}>
          再設定メールを送信
        </LinkButton>
        <LinkButton
          className="flex-1"
          render={<Link href="/login" />}
          variant="outline"
        >
          ログイン画面へ
        </LinkButton>
      </div>
    </div>
  );
};

const ConfirmPasswordFallback = () => (
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <div className="h-5 animate-pulse rounded bg-muted/70" />
    <div className="h-11 animate-pulse rounded bg-muted/70" />
    <div className="h-11 animate-pulse rounded bg-muted/70" />
    <div className="h-10 animate-pulse rounded bg-muted" />
  </div>
);

const ConfirmPasswordPageContent = async ({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    status?: string | string[];
    token?: string | string[];
  }>;
}) => {
  await connection();

  const { errorMessage, status, token } = parseConfirmPasswordSearchParams(
    await searchParams
  );

  let failureStatus: "expired" | "invalid" | null = null;
  if (status === "expired" || status === "invalid") {
    failureStatus = status;
  } else if (token === "") {
    failureStatus = "invalid";
  }

  return failureStatus ? (
    <FailureState status={failureStatus} />
  ) : (
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <p className="text-sm text-muted-foreground">
        新しいパスワードを入力してください。設定後はログイン画面からすぐに利用できます。
      </p>

      <form action={confirmPasswordAction} className="space-y-4">
        <input name="token" type="hidden" value={token} />

        <Field>
          <FieldLabel htmlFor="password" required>
            新しいパスワード
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="new-password"
              id="password"
              name="password"
              placeholder="••••••••"
              required
              type="password"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="confirm_password" required>
            新しいパスワード（確認）
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="new-password"
              id="confirm_password"
              name="confirm_password"
              placeholder="••••••••"
              required
              type="password"
            />
          </FieldContent>
        </Field>

        {errorMessage ? (
          <FormMessage variant="destructive">{errorMessage}</FormMessage>
        ) : null}

        <Button className="w-full" type="submit">
          新しいパスワードを設定
        </Button>
      </form>
    </div>
  );
};

const ConfirmPasswordPage = ({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    status?: string | string[];
    token?: string | string[];
  }>;
}) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          新しいパスワードの設定
        </p>
      </div>

      <Suspense fallback={<ConfirmPasswordFallback />}>
        <ConfirmPasswordPageContent searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default ConfirmPasswordPage;
