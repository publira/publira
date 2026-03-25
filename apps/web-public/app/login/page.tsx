import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  PUBLIC_SESSION_COOKIE_NAME,
  loginPublic,
  sanitizeRedirectPath,
  sessionCookieOptions,
} from "../../lib/auth";

export const metadata: Metadata = {
  title: "ログイン",
};

const buildLoginErrorPath = (message: string, returnToPath: string): string => {
  const params = new URLSearchParams({
    error: message,
    returnTo: sanitizeRedirectPath(returnToPath),
  });
  return `/login?${params.toString()}`;
};

const loginAction = async (formData: FormData): Promise<void> => {
  "use server";

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const returnToPath = sanitizeRedirectPath(
    String(formData.get("returnTo") ?? "/")
  );

  const result = await loginPublic(email, password);
  if (!result) {
    redirect(
      buildLoginErrorPath(
        "メールアドレスまたはパスワードが正しくありません。",
        returnToPath
      )
    );
  }

  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions,
    expires: result.expiresAt,
    name: PUBLIC_SESSION_COOKIE_NAME,
    value: result.sessionId,
  });

  redirect(returnToPath);
};

const pickFirstQueryParam = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value.at(0);
  }
  return value;
};

const getLoginViewModel = async (
  searchParams: PageProps<"/login">["searchParams"]
): Promise<{ errorMessage?: string; returnToPath: string }> => {
  const params = await searchParams;
  const error = pickFirstQueryParam(params.error);
  const returnTo = pickFirstQueryParam(params.returnTo);

  return {
    errorMessage: error?.trim() || undefined,
    returnToPath: sanitizeRedirectPath(returnTo),
  };
};

const LoginForm = ({
  errorMessage,
  returnToPath,
}: {
  errorMessage?: string;
  returnToPath: string;
}) => (
  <>
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <form action={loginAction} className="space-y-4">
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

        <Button className="mt-2 w-full" type="submit">
          ログイン
        </Button>
      </form>
    </div>

    <div className="mt-4 text-center text-sm">
      <span className="text-muted-foreground">
        アカウントをお持ちでない方は
      </span>{" "}
      <Link href="/signup" className="font-medium text-primary hover:underline">
        新規登録
      </Link>
    </div>
  </>
);

const LoginFormContent = async ({
  searchParams,
}: Pick<PageProps<"/login">, "searchParams">) => {
  const { errorMessage, returnToPath } = await getLoginViewModel(searchParams);

  return <LoginForm errorMessage={errorMessage} returnToPath={returnToPath} />;
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold">Publira</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            静かに読む、持続可能に出版する
          </p>
        </div>

        <Suspense fallback={<LoginForm returnToPath="/" />}>
          <LoginFormContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
