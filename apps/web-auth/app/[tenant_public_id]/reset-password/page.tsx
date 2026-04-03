import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { guardPlaceholder } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { requestPublicPasswordReset } from "#lib/auth";
import { getTenantSiteInfo } from "#lib/tenant";

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
  const tenantPublicId = String(formData.get("tenantPublicId") ?? "").trim();

  if (!email) {
    redirect(buildResetPasswordErrorPath("メールアドレスを入力してください。"));
  }

  const requested = await requestPublicPasswordReset(email, tenantPublicId);
  if (!requested) {
    redirect(
      buildResetPasswordErrorPath(
        "再設定メールの送信に失敗しました。入力内容をご確認ください。"
      )
    );
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

const ResetPasswordForm = ({
  tenantPublicId,
  errorMessage,
}: {
  tenantPublicId: string;
  errorMessage?: string;
}) => (
  <>
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <form action={requestPasswordResetAction} className="space-y-4">
        <input name="tenantPublicId" type="hidden" value={tenantPublicId} />

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

        {errorMessage ? (
          <FormMessage variant="destructive">{errorMessage}</FormMessage>
        ) : null}

        <Button className="mt-2 w-full" type="submit">
          再設定メールを送信
        </Button>
      </form>
    </div>

    <div className="mt-4 text-center text-sm">
      <Link href="/login" className="font-medium text-primary hover:underline">
        ログイン画面へ戻る
      </Link>
    </div>
  </>
);

const ResetPasswordFormContent = async ({
  searchParams,
  tenantPublicId,
}: {
  searchParams: PageProps<"/[tenant_public_id]/reset-password">["searchParams"];
  tenantPublicId: string;
}) => {
  const sp = await searchParams;
  const errorMessage = pickFirstQueryParam(sp.error)?.trim();

  return (
    <ResetPasswordForm
      errorMessage={errorMessage}
      tenantPublicId={tenantPublicId}
    />
  );
};

const ResetPasswordPageContent = async ({
  params,
  searchParams,
}: PageProps<"/[tenant_public_id]/reset-password">) => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const info = await getTenantSiteInfo(tenant_public_id);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteTagline = info?.siteTagline?.trim();

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <TenantDocumentTitle
          pageTitle="パスワード再設定"
          siteLabel={siteLabel}
        />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </div>

      <Suspense
        fallback={<ResetPasswordForm tenantPublicId={tenant_public_id} />}
      >
        <ResetPasswordFormContent
          searchParams={searchParams}
          tenantPublicId={tenant_public_id}
        />
      </Suspense>
    </div>
  );
};

const ResetPasswordPageFallback = () => (
  <div className="w-full max-w-sm">
    <div className="mb-8 text-center">
      <h1 className="font-serif text-2xl font-semibold">サイト</h1>
    </div>
    <ResetPasswordForm tenantPublicId="" />
  </div>
);

export default function ResetPasswordPage({
  params,
  searchParams,
}: PageProps<"/[tenant_public_id]/reset-password">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Suspense fallback={<ResetPasswordPageFallback />}>
        <ResetPasswordPageContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
