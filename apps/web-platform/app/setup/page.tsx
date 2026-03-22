import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { createInitialUser, isSetupCompleted } from "../../lib/platform-setup";

export const metadata: Metadata = {
  title: "初期セットアップ",
};

const setupAction = async (formData: FormData): Promise<void> => {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!name || !email || !password) {
    redirect(
      `/setup?error=${encodeURIComponent("すべての項目を入力してください。")}`
    );
  }

  if (password !== confirmPassword) {
    redirect(
      `/setup?error=${encodeURIComponent("パスワードと確認用パスワードが一致しません。")}`
    );
  }

  const result = await createInitialUser(name, email, password);
  if (!result.ok) {
    if (result.message.includes("既に完了")) {
      redirect("/login");
    }
    redirect(`/setup?error=${encodeURIComponent(result.message)}`);
  }

  redirect("/login?setup=done");
};

interface SetupPageProps {
  searchParams: Promise<{
    error?: string;
  }>;
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  await connection();

  const setupDone = await isSetupCompleted();
  if (setupDone) {
    redirect("/login");
  }

  const params = await searchParams;
  const errorMessage = params.error?.trim();

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold">Publira</h1>
          <p className="mt-2 text-sm text-muted-foreground">初期セットアップ</p>
        </div>

        <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
          <p className="text-sm text-muted-foreground">
            最初の管理ユーザーアカウントを作成してください。
          </p>

          <form action={setupAction} className="space-y-4">
            <Field>
              <FieldLabel htmlFor="name" required>
                氏名
              </FieldLabel>
              <FieldContent>
                <Input
                  autoComplete="name"
                  id="name"
                  name="name"
                  placeholder="管理者 太郎"
                  required
                  type="text"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="email" required>
                メールアドレス
              </FieldLabel>
              <FieldContent>
                <Input
                  autoComplete="email"
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
              <FieldLabel htmlFor="confirmPassword" required>
                パスワード（確認）
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
              管理ユーザーを作成する
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
