import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { loginAction } from "./_lib/actions";
import { parseLoginSearchParams } from "./_lib/search-params";

export const metadata: Metadata = {
  title: "ログイン",
};

const LoginForm = async ({
  errorMessage,
  resetDone,
  returnToPath,
}: {
  errorMessage?: string;
  resetDone?: boolean;
  returnToPath: string;
}) => {
  const tenantId = await getTenantId();
  return (
    <>
      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <form action={loginAction} className="space-y-4">
          <input name="tenantId" type="hidden" value={tenantId} />
          <input name="returnTo" type="hidden" value={returnToPath} />

          <Field>
            <FieldLabel htmlFor="email" required>
              メールアドレス
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="email"
                id="email"
                name="email"
                placeholder="your@email.com"
                required
                type="email"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="password" required>
              パスワード
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="current-password"
                id="password"
                name="password"
                placeholder="••••••••"
                required
                type="password"
              />
            </FieldContent>
          </Field>

          {errorMessage ? (
            <FormMessage variant="destructive">{errorMessage}</FormMessage>
          ) : null}

          {resetDone ? (
            <FormMessage variant="success">
              パスワードを再設定しました。新しいパスワードでログインしてください。
            </FormMessage>
          ) : null}

          <Button className="mt-2 w-full" type="submit">
            ログイン
          </Button>
        </form>

        <div className="text-right text-sm">
          <Link
            href="/reset-password"
            className="font-medium text-primary hover:underline"
          >
            パスワードをお忘れですか？
          </Link>
        </div>
      </div>

      <div className="mt-4 text-center text-sm">
        <span className="text-muted-foreground">
          アカウントをお持ちでない方は
        </span>{" "}
        <Link
          href="/signup"
          className="font-medium text-primary hover:underline"
        >
          新規登録
        </Link>
      </div>
    </>
  );
};

const LoginFormContent = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/login">["searchParams"];
}) => {
  const { errorMessage, resetDone, returnToPath } = parseLoginSearchParams(
    await searchParams
  );

  return (
    <LoginForm
      errorMessage={errorMessage}
      resetDone={resetDone}
      returnToPath={returnToPath}
    />
  );
};

const LoginPageContent = async ({
  searchParams,
}: PageProps<"/[tenant_id]/login">) => {
  const tenantId = await getTenantId();

  const info = await getTenantSiteInfo(tenantId);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteTagline = info?.siteTagline?.trim();

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <TenantDocumentTitle pageTitle="ログイン" siteLabel={siteLabel} />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </div>
      <Suspense fallback={<LoginForm returnToPath="/" />}>
        <LoginFormContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
};

const LoginPageFallback = () => (
  <div className="w-full max-w-sm">
    <div className="mb-8 text-center">
      <h1 className="font-serif text-2xl font-semibold">サイト</h1>
    </div>
    <LoginForm returnToPath="/" />
  </div>
);

const LoginPage = ({
  params,
  searchParams,
}: PageProps<"/[tenant_id]/login">) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent params={params} searchParams={searchParams} />
    </Suspense>
  </main>
);

export default LoginPage;
