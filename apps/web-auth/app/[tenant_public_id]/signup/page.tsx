import { guardPlaceholder } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { signupPublic } from "#lib/auth";
import { getTenantSiteInfo } from "#lib/tenant";

export const metadata: Metadata = {
  title: "新規登録",
};

const buildSignupErrorPath = (message: string): string => {
  const params = new URLSearchParams({ error: message });
  return `/signup?${params.toString()}`;
};

const buildSignupPendingPath = (email: string): string => {
  const params = new URLSearchParams({ email });
  return `/signup/pending?${params.toString()}`;
};

const signupAction = async (formData: FormData): Promise<void> => {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const tenantPublicId = String(formData.get("tenantPublicId") ?? "").trim();

  if (!name || !email || !password) {
    redirect(
      buildSignupErrorPath("名前・メールアドレス・パスワードは必須です。")
    );
  }
  if (password !== confirmPassword) {
    redirect(buildSignupErrorPath("パスワード確認が一致しません。"));
  }

  const result = await signupPublic(name, email, password, tenantPublicId);
  if (!result) {
    redirect(
      buildSignupErrorPath("新規登録に失敗しました。入力内容をご確認ください。")
    );
  }

  if (result.pendingVerification) {
    redirect(buildSignupPendingPath(email));
  }

  redirect("/my");
};

const SignupForm = ({
  tenantPublicId,
  error,
}: {
  tenantPublicId: string;
  error: string;
}) => (
  <>
    <div className="space-y-6 rounded-lg border border-border/70 bg-card p-8">
      <form action={signupAction} className="space-y-4">
        <input name="tenantPublicId" type="hidden" value={tenantPublicId} />

        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            お名前
          </label>
          <input
            id="name"
            name="name"
            type="text"
            placeholder="山田太郎"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            メールアドレス
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="your@email.com"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            パスワード
          </label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium"
          >
            パスワード（確認）
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            placeholder="••••••••"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          className="mt-6 w-full rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90"
        >
          新規登録
        </button>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>

    <div className="mt-4 text-center text-sm">
      <span className="text-muted-foreground">
        すでにアカウントをお持ちの方は
      </span>{" "}
      <Link href="/login" className="font-medium text-primary hover:underline">
        ログイン
      </Link>
    </div>
  </>
);

const SignupFormContent = async ({
  searchParams,
  tenantPublicId,
}: {
  searchParams: PageProps<"/[tenant_public_id]/signup">["searchParams"];
  tenantPublicId: string;
}) => {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error.trim() : "";

  return <SignupForm error={error} tenantPublicId={tenantPublicId} />;
};

const SignupPageContent = async ({
  params,
  searchParams,
}: PageProps<"/[tenant_public_id]/signup">) => {
  const { tenant_public_id } = await params;

  guardPlaceholder(tenant_public_id);

  const info = await getTenantSiteInfo(tenant_public_id);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteTagline = info?.siteTagline?.trim();

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <TenantDocumentTitle pageTitle="新規登録" siteLabel={siteLabel} />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </div>

      <Suspense
        fallback={<SignupForm error="" tenantPublicId={tenant_public_id} />}
      >
        <SignupFormContent
          searchParams={searchParams}
          tenantPublicId={tenant_public_id}
        />
      </Suspense>
    </div>
  );
};

const SignupPageFallback = () => (
  <div className="w-full max-w-sm">
    <div className="mb-8 text-center">
      <h1 className="font-serif text-2xl font-semibold">サイト</h1>
    </div>
    <SignupForm error="" tenantPublicId="" />
  </div>
);

export default function SignupPage({
  params,
  searchParams,
}: PageProps<"/[tenant_public_id]/signup">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Suspense fallback={<SignupPageFallback />}>
        <SignupPageContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
