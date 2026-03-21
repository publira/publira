import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  PLATFORM_SESSION_COOKIE_NAME,
  loginPlatform,
  sanitizeRedirectPath,
  sessionCookieOptions,
} from "../../lib/platform-auth";

interface LoginPageProps {
  searchParams: Promise<{
    error?: string;
    next?: string;
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

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = sanitizeRedirectPath(String(formData.get("next") ?? "/"));

  const result = await loginPlatform(email, password);
  if (!result) {
    redirect(
      buildLoginErrorPath(
        "メールアドレスとパスワードを入力してください。",
        nextPath
      )
    );
  }

  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions,
    expires: result.expiresAt,
    name: PLATFORM_SESSION_COOKIE_NAME,
    value: result.sessionId,
  });

  redirect(nextPath);
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorMessage = params.error?.trim();
  const nextPath = sanitizeRedirectPath(params.next);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold">Publira</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Platform Console ログイン
          </p>
        </div>

        <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
          <form action={loginAction} className="space-y-4">
            <input name="next" type="hidden" value={nextPath} />

            <Field>
              <FieldLabel htmlFor="email" required>
                メールアドレス
              </FieldLabel>
              <FieldContent>
                <Input
                  autoComplete="email"
                  id="email"
                  name="email"
                  placeholder="operator@example.com"
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
      </div>
    </main>
  );
}
