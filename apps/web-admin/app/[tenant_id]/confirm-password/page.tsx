import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { confirmAdminPasswordReset } from "#lib/admin-auth";
import { getTenantId } from "#lib/tenant-id";

export const metadata: Metadata = {
  title: "新しいパスワードの設定",
};

interface ConfirmPasswordPageProps {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{
    error?: string;
    status?: string;
    token?: string;
  }>;
}

const buildConfirmPasswordPath = ({
  error,
  status,
  token,
}: {
  error?: string;
  status?: "expired" | "invalid";
  token?: string;
}): string => {
  const params = new URLSearchParams();

  if (error?.trim()) {
    params.set("error", error.trim());
  }
  if (status) {
    params.set("status", status);
  }
  if (token?.trim()) {
    params.set("token", token.trim());
  }

  const query = params.toString();
  return query ? `/confirm-password?${query}` : "/confirm-password";
};

const buildLoginPath = (): string =>
  `/login?${new URLSearchParams({ reset: "done" }).toString()}`;

const confirmPasswordAction = async (formData: FormData): Promise<void> => {
  "use server";

  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const confirmPassword = String(formData.get("confirm_password") ?? "").trim();

  if (!tenantId) {
    redirect(
      buildConfirmPasswordPath({
        error: "テナント識別子が見つかりませんでした。",
        token,
      })
    );
  }

  if (!token) {
    redirect(buildConfirmPasswordPath({ status: "invalid" }));
  }

  if (!password || !confirmPassword) {
    redirect(
      buildConfirmPasswordPath({
        error: "新しいパスワードと確認用パスワードを入力してください。",
        token,
      })
    );
  }

  if (password !== confirmPassword) {
    redirect(
      buildConfirmPasswordPath({
        error: "パスワード確認が一致しません。",
        token,
      })
    );
  }

  const result = await confirmAdminPasswordReset(tenantId, token, password);
  if (!result.ok) {
    if (result.reason === "expired" || result.reason === "invalid") {
      redirect(buildConfirmPasswordPath({ status: result.reason }));
    }

    redirect(
      buildConfirmPasswordPath({
        error: result.message,
        token,
      })
    );
  }

  redirect(buildLoginPath());
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
        <LinkButton
          className="flex-1"
          render={<Link href="/forgot-password" />}
        >
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
}: ConfirmPasswordPageProps) => {
  const tenantId = await getTenantId();

  const sp = await searchParams;
  const errorMessage = sp.error?.trim();
  const status = sp.status?.trim();
  const token = sp.token?.trim() ?? "";

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
        <input name="tenant_id" type="hidden" value={tenantId} />
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
  params,
  searchParams,
}: ConfirmPasswordPageProps) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-serif text-2xl font-semibold">
          新しいパスワードの設定
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          メールで受け取ったリンクから、管理画面用の新しいパスワードを設定します。
        </p>
      </div>

      <Suspense fallback={<ConfirmPasswordFallback />}>
        <ConfirmPasswordPageContent
          params={params}
          searchParams={searchParams}
        />
      </Suspense>
    </div>
  </main>
);

export default ConfirmPasswordPage;
