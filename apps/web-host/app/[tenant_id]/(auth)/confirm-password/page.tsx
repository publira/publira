import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Skeleton } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { confirmPasswordAction } from "./_lib/actions";
import { parseConfirmPasswordSearchParams } from "./_lib/search-params";

export const metadata: Metadata = {
  title: "新しいパスワード設定",
};

/**
 * Cache Components streams the static shell first. An operable fallback
 * with `token=""` would submit an empty token, or flash the invalid-link
 * copy, before `searchParams` resolve (#994).
 */
const ConfirmPasswordFormSkeleton = () => (
  <>
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="mt-2 h-10 w-full" />
      </div>
    </div>
    <div className="mt-4 flex justify-center">
      <Skeleton className="h-4 w-40" />
    </div>
  </>
);

const ConfirmPasswordForm = async ({
  token,
  errorMessage,
}: {
  token: string;
  errorMessage?: string;
}) => {
  const tenantId = await getTenantId();
  if (!token) {
    return (
      <>
        <section className="space-y-3 text-sm leading-6">
          <p>確認リンクが無効です。</p>
        </section>
        <div className="text-center text-sm">
          <Link
            href="/reset-password"
            className="font-medium text-primary hover:underline"
          >
            パスワード再設定へ戻る
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <form action={confirmPasswordAction} className="space-y-4">
          <input name="tenantId" type="hidden" value={tenantId} />
          <input name="token" type="hidden" value={token} />

          <Field>
            <FieldLabel htmlFor="newPassword" required>
              新しいパスワード
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="new-password"
                id="newPassword"
                name="newPassword"
                placeholder="••••••••"
                required
                type="password"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="confirmPassword" required>
              新しいパスワード（確認）
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="new-password"
                id="confirmPassword"
                name="confirmPassword"
                placeholder="••••••••"
                required
                type="password"
              />
            </FieldContent>
          </Field>

          {errorMessage ? (
            <FormMessage variant="destructive">{errorMessage}</FormMessage>
          ) : null}

          <Button className="mt-2 w-full" type="submit">
            パスワードを再設定
          </Button>
        </form>
      </div>

      <div className="mt-4 text-center text-sm">
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          ログイン画面へ戻る
        </Link>
      </div>
    </>
  );
};

const ConfirmPasswordFormContent = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/confirm-password">["searchParams"];
}) => {
  await connection();

  const { errorMessage, token } = parseConfirmPasswordSearchParams(
    await searchParams
  );

  return <ConfirmPasswordForm errorMessage={errorMessage} token={token} />;
};

const ConfirmPasswordPageContent = async ({
  searchParams,
}: PageProps<"/[tenant_id]/confirm-password">) => {
  const tenantId = await getTenantId();

  const info = await getTenantSiteInfo(tenantId);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteTagline = info?.siteTagline?.trim();

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <TenantDocumentTitle
          pageTitle="新しいパスワード設定"
          siteLabel={siteLabel}
        />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </div>
      <Suspense fallback={<ConfirmPasswordFormSkeleton />}>
        <ConfirmPasswordFormContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
};

const ConfirmPasswordPageFallback = () => (
  <div className="w-full max-w-sm">
    <div className="mb-8 text-center">
      <h1 className="font-serif text-2xl font-semibold">サイト</h1>
    </div>
    <ConfirmPasswordFormSkeleton />
  </div>
);

const ConfirmPasswordPage = ({
  params,
  searchParams,
}: PageProps<"/[tenant_id]/confirm-password">) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <Suspense fallback={<ConfirmPasswordPageFallback />}>
      <ConfirmPasswordPageContent params={params} searchParams={searchParams} />
    </Suspense>
  </main>
);

export default ConfirmPasswordPage;
