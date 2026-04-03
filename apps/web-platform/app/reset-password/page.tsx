import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { requestPlatformPasswordReset } from "#lib/password-reset";

export const metadata: Metadata = {
  title: "パスワード再設定",
};

const buildResetPasswordErrorPath = (message: string): string => {
  const params = new URLSearchParams({ error: message });
  return `/reset-password?${params.toString()}`;
};

const buildResetPasswordRequestedPath = (email: string): string => {
  const params = new URLSearchParams({ email });
  return `/reset-password/requested?${params.toString()}`;
};

const requestPasswordResetAction = async (
  formData: FormData
): Promise<void> => {
  "use server";

  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    redirect(buildResetPasswordErrorPath("メールアドレスを入力してください。"));
  }

  const result = await requestPlatformPasswordReset(email);
  if (!result.ok) {
    redirect(buildResetPasswordErrorPath(result.message));
  }

  redirect(buildResetPasswordRequestedPath(email));
};

const pickFirstQueryParam = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value.at(0);
  }
  return value;
};

const ResetPasswordForm = ({ errorMessage }: { errorMessage?: string }) => (
  <>
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <form action={requestPasswordResetAction} className="space-y-4">
        <Field>
          <FieldLabel htmlFor="email" required>
            メールアドレス
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              id="email"
              name="email"
              placeholder="operator@example.com"
              required
              type="email"
            />
          </FieldContent>
        </Field>

        {errorMessage ? (
          <FormMessage variant="destructive">{errorMessage}</FormMessage>
        ) : null}

        <Button className="mt-2 w-full" type="submit">
          再設定メールを送信
        </Button>
      </form>
    </div>

    <div className="mt-4 text-center text-sm">
      <Link className="font-medium text-primary hover:underline" href="/login">
        ログイン画面へ戻る
      </Link>
    </div>
  </>
);

const ResetPasswordFormContent = async ({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) => {
  await connection();

  const sp = await searchParams;
  const errorMessage = pickFirstQueryParam(sp.error)?.trim();

  return <ResetPasswordForm errorMessage={errorMessage} />;
};

const ResetPasswordFormFallback = () => <ResetPasswordForm />;

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold">Publira</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            登録済みのメールアドレス宛てに、再設定リンクを送信します。
          </p>
        </div>

        <Suspense fallback={<ResetPasswordFormFallback />}>
          <ResetPasswordFormContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
