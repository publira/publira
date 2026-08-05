import { FormMessage } from "@publira/ui-components/form-message";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { isSetupCompleted } from "#lib/setup";

import { SetupForm } from "./_components/setup-form";

export const metadata: Metadata = {
  title: "初期セットアップ",
};

const Guard = async ({ children }: { children: React.ReactNode }) => {
  await connection();

  const setupStatus = await isSetupCompleted();

  if (setupStatus === true) {
    redirect("/login");
  }

  return setupStatus === null ? (
    <FormMessage variant="destructive">
      APIサーバーに接続できません。サーバーの起動状態を確認してから再試行してください。
    </FormMessage>
  ) : (
    children
  );
};

const SetupPage = () => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">初期セットアップ</p>
      </div>

      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <Suspense fallback={null}>
          <Guard>
            <p className="text-sm text-muted-foreground">
              最初の管理ユーザーアカウントを作成してください。
            </p>

            <SetupForm />
          </Guard>
        </Suspense>
      </div>
    </div>
  </main>
);

export default SetupPage;
