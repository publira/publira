import type { Metadata } from "next";

import { ResetPasswordForm } from "./_components/reset-password-form";

export const metadata: Metadata = {
  title: "パスワード再設定",
};

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold">Publira</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            登録済みのメールアドレス宛てに、再設定リンクを送信します。
          </p>
        </div>

        <ResetPasswordForm />
      </div>
    </main>
  );
}
