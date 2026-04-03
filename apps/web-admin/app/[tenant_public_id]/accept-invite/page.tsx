import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { guardPlaceholder } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  acceptTenantAdminInvitation,
  getTenantAdminInvitationState,
} from "#lib/admin-auth";

export const metadata: Metadata = {
  title: "管理者招待の承諾",
};

interface AcceptInvitePageProps {
  params: Promise<{ tenant_public_id: string }>;
  searchParams: Promise<{
    error?: string;
    token?: string;
  }>;
}

const buildErrorPath = (token: string, message: string): string => {
  const params = new URLSearchParams({
    error: message,
    token,
  });
  return `/accept-invite?${params.toString()}`;
};

const buildLoginPath = (email: string): string => {
  const params = new URLSearchParams({
    invited: "done",
    next: "/",
  });
  if (email.trim()) {
    params.set("email", email.trim());
  }
  return `/login?${params.toString()}`;
};

const acceptInviteAction = async (formData: FormData): Promise<void> => {
  "use server";

  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  const accountExists = String(formData.get("account_exists") ?? "") === "true";
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const confirmPassword = String(formData.get("confirm_password") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!token) {
    redirect(buildErrorPath("", "招待トークンが見つかりません。"));
  }

  if (!accountExists) {
    if (!name || !password) {
      redirect(buildErrorPath(token, "名前とパスワードを入力してください。"));
    }
    if (password !== confirmPassword) {
      redirect(buildErrorPath(token, "パスワード確認が一致しません。"));
    }
  }

  const result = await acceptTenantAdminInvitation(
    tenantPublicId,
    token,
    accountExists ? undefined : name,
    accountExists ? undefined : password
  );

  if (!result.ok) {
    redirect(buildErrorPath(token, result.message));
  }

  redirect(buildLoginPath(email));
};

const AcceptInviteFormContent = async ({
  tenantPublicId,
  token,
  error,
}: {
  tenantPublicId: string;
  token: string;
  error?: string;
}) => {
  const invitation = await getTenantAdminInvitationState(tenantPublicId, token);

  if (!invitation) {
    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="destructive">招待が見つかりません。</FormMessage>
        <div className="text-center text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href="/login"
          >
            ログイン画面へ
          </Link>
        </div>
      </div>
    );
  }

  if (invitation.status !== "pending") {
    let statusMessage = "この招待は期限切れです。";
    if (invitation.status === "accepted") {
      statusMessage = "この招待はすでに承諾済みです。";
    } else if (invitation.status === "canceled") {
      statusMessage = "この招待は取り消されています。";
    }

    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="destructive">{statusMessage}</FormMessage>
        <div className="text-center text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href="/login"
          >
            ログイン画面へ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <p className="text-sm text-muted-foreground">
        {invitation.email} をテナント管理者として招待しています。
      </p>

      <form action={acceptInviteAction} className="space-y-4">
        <input name="tenant_public_id" type="hidden" value={tenantPublicId} />
        <input name="token" type="hidden" value={token} />
        <input
          name="account_exists"
          type="hidden"
          value={String(invitation.accountExists)}
        />
        <input name="email" type="hidden" value={invitation.email} />

        {invitation.accountExists ? (
          <p className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            既存アカウントとして承諾します。承諾後はこのメールアドレスでログインできます。
          </p>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="name" required>
                お名前
              </FieldLabel>
              <FieldContent>
                <Input
                  id="name"
                  name="name"
                  placeholder="山田 太郎"
                  required
                  type="text"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="password" required>
                パスワード
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
                パスワード（確認）
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
          </>
        )}

        {error ? (
          <FormMessage variant="destructive">{error}</FormMessage>
        ) : null}

        <Button className="w-full" type="submit" variant="outline">
          招待を承諾する
        </Button>
      </form>
    </div>
  );
};

const AcceptInviteForm = ({
  tenantPublicId,
  token,
  error,
}: {
  tenantPublicId: string;
  token: string;
  error?: string;
}) => {
  if (!token) {
    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="destructive">
          招待トークンが見つかりません。
        </FormMessage>
        <div className="text-center text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href="/login"
          >
            ログイン画面へ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={<div className="h-40 animate-pulse rounded bg-muted/70" />}
    >
      <AcceptInviteFormContent
        error={error}
        tenantPublicId={tenantPublicId}
        token={token}
      />
    </Suspense>
  );
};

export default async function AcceptInvitePage({
  params,
  searchParams,
}: AcceptInvitePageProps) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const sp = await searchParams;
  const token = sp.token?.trim() ?? "";
  const error = sp.error?.trim();

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-serif text-2xl font-semibold">
            管理者招待の承諾
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            招待を承諾すると、このテナントの管理画面にアクセスできます。
          </p>
        </div>

        <AcceptInviteForm
          error={error}
          tenantPublicId={tenant_public_id}
          token={token}
        />
      </div>
    </main>
  );
}
