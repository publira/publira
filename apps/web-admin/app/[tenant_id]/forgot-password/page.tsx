import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { getTenantId } from "#lib/tenant-id";

import { requestPasswordResetAction } from "./_lib/actions";
import { parseForgotPasswordSearchParams } from "./_lib/search-params";

export const metadata: Metadata = {
  title: "パスワード再設定",
};

interface ForgotPasswordPageProps {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{
    email?: string;
    error?: string;
    requested?: string;
  }>;
}

const ForgotPasswordFallback = () => (
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <div className="h-11 animate-pulse rounded bg-muted/70" />
    <div className="h-10 animate-pulse rounded bg-muted" />
  </div>
);

const ForgotPasswordPageContent = async ({
  searchParams,
}: ForgotPasswordPageProps) => {
  const tenantId = await getTenantId();

  const { defaultEmail, errorMessage, requested } =
    parseForgotPasswordSearchParams(await searchParams);

  return requested ? (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <FormMessage variant="success">
        メールアドレスが登録されている場合、パスワード再設定メールを送信しました。
      </FormMessage>
      <p className="text-sm text-muted-foreground">
        メール内のリンクから新しいパスワードを設定してください。届かない場合は、少し時間を置いて再度お試しください。
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <LinkButton className="flex-1" render={<Link href="/login" />}>
          ログイン画面へ戻る
        </LinkButton>
        <LinkButton
          className="flex-1"
          render={<Link href="/forgot-password" />}
          variant="outline"
        >
          別のメールアドレスで試す
        </LinkButton>
      </div>
    </div>
  ) : (
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <form action={requestPasswordResetAction} className="space-y-4">
        <input name="tenant_id" type="hidden" value={tenantId} />

        <Field>
          <FieldLabel required>メールアドレス</FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              defaultValue={defaultEmail}
              name="email"
              placeholder="admin@example.com"
              required
              type="email"
            />
          </FieldContent>
        </Field>

        {errorMessage ? (
          <FormMessage variant="destructive">{errorMessage}</FormMessage>
        ) : null}

        <Button className="w-full" type="submit">
          再設定メールを送信
        </Button>
      </form>

      <div className="text-center text-sm">
        <Link
          className="font-medium text-primary hover:underline"
          href="/login"
        >
          ログイン画面へ戻る
        </Link>
      </div>
    </div>
  );
};

const ForgotPasswordPage = ({
  params,
  searchParams,
}: ForgotPasswordPageProps) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-serif text-2xl font-semibold">パスワード再設定</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          管理画面に登録済みのメールアドレス宛てに、再設定リンクを送信します。
        </p>
      </div>

      <Suspense fallback={<ForgotPasswordFallback />}>
        <ForgotPasswordPageContent
          params={params}
          searchParams={searchParams}
        />
      </Suspense>
    </div>
  </main>
);

export default ForgotPasswordPage;
