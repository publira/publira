import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { encryptSessionPayload, resolveAuthSecret } from "@publira/web-session";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  ADMIN_SESSION_COOKIE_NAME,
  loginAdmin,
  sanitizeRedirectPath,
  sessionCookieOptions,
} from "#lib/admin-auth";
import { getTenantId } from "#lib/tenant-id";

export const metadata: Metadata = {
  title: "ログイン",
};

interface LoginPageProps {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{
    email?: string;
    error?: string;
    invited?: string;
    next?: string;
    reset?: string;
  }>;
}

const buildLoginErrorPath = (message: string, nextPath: string): string => {
  const params = new URLSearchParams({
    error: message,
    next: sanitizeRedirectPath(nextPath),
  });
  return `/login?${params.toString()}`;
};

const loginAction = async (formData: FormData): Promise<void> => {
  "use server";

  const tenantId = String(formData.get("tenant_id"));

  if (!tenantId) {
    redirect(
      buildLoginErrorPath("テナント識別子が見つかりませんでした。", "/")
    );
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = sanitizeRedirectPath(String(formData.get("next") ?? "/"));

  if (!email || !password) {
    redirect(
      buildLoginErrorPath(
        "メールアドレスとパスワードを入力してください。",
        next
      )
    );
  }

  const result = await loginAdmin(email, password, tenantId);
  if (!result.ok) {
    redirect(buildLoginErrorPath(result.message, next));
  }

  try {
    const sealed = await encryptSessionPayload(
      {
        accessToken: result.accessToken,
        expiresAt: result.expiresAt.toISOString(),
        tenantId,
      },
      resolveAuthSecret()
    );
    const cookieStore = await cookies();
    cookieStore.set({
      ...sessionCookieOptions,
      expires: result.expiresAt,
      name: ADMIN_SESSION_COOKIE_NAME,
      value: sealed,
    });
  } catch (error) {
    // Not an RPC failure — sealing or writing the cookie broke, and the reason
    // is only visible in the log. Recorded, then reported as a login failure.
    console.error("[web-admin] login cookie seal failed", error);
    redirect(
      buildLoginErrorPath(
        "ログイン処理に失敗しました。時間をおいて再試行してください。",
        next
      )
    );
  }

  redirect(next);
};

const LoginPageFallback = () => (
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <div className="h-11 animate-pulse rounded bg-muted/70" />
    <div className="h-11 animate-pulse rounded bg-muted/70" />
    <div className="h-10 animate-pulse rounded bg-muted" />
  </div>
);

const LoginPageContent = async ({
  searchParams,
}: Pick<LoginPageProps, "searchParams">) => {
  const tenantId = await getTenantId();

  const sp = await searchParams;
  const errorMessage = sp.error?.trim();
  const defaultEmail = sp.email?.trim() ?? "";
  const invitedDone = sp.invited?.trim() === "done";
  const nextPath = sanitizeRedirectPath(sp.next);
  const passwordResetDone = sp.reset?.trim() === "done";
  const forgotPasswordHref = defaultEmail
    ? `/forgot-password?${new URLSearchParams({ email: defaultEmail }).toString()}`
    : "/forgot-password";

  return (
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <form action={loginAction} className="space-y-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="next" type="hidden" value={nextPath} />

        <Field>
          <FieldLabel htmlFor="email" required>
            メールアドレス
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              defaultValue={defaultEmail}
              id="email"
              name="email"
              placeholder="admin@example.com"
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

        {invitedDone ? (
          <FormMessage variant="success">
            招待の承諾が完了しました。ログインしてください。
          </FormMessage>
        ) : null}

        {passwordResetDone ? (
          <FormMessage variant="success">
            パスワードを再設定しました。新しいパスワードでログインしてください。
          </FormMessage>
        ) : null}

        {errorMessage ? (
          <FormMessage variant="destructive">{errorMessage}</FormMessage>
        ) : null}

        <div className="text-right text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href={forgotPasswordHref}
          >
            パスワードを忘れた場合
          </Link>
        </div>

        <Button className="mt-2 w-full" type="submit">
          ログイン
        </Button>
      </form>
    </div>
  );
};

const LoginPage = (props: LoginPageProps) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">管理画面ログイン</p>
      </div>

      <Suspense fallback={<LoginPageFallback />}>
        <LoginPageContent {...props} />
      </Suspense>
    </div>
  </main>
);

export default LoginPage;
