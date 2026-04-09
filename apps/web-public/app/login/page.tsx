import type { Metadata } from "next";
import { Suspense } from "react";

import { sanitizeRedirectPath } from "#lib/auth";

import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = {
  title: "ログイン",
};

const pickFirstQueryParam = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value.at(0);
  }
  return value;
};

const LoginFormWrapper = async ({
  searchParams,
}: Pick<PageProps<"/login">, "searchParams">) => {
  const params = await searchParams;
  const returnTo = pickFirstQueryParam(params.returnTo);

  return <LoginForm returnToPath={sanitizeRedirectPath(returnTo)} />;
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold">ログイン</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            メールアドレスとパスワードを入力してください
          </p>
        </div>

        <Suspense fallback={<LoginForm returnToPath="/" />}>
          <LoginFormWrapper searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
