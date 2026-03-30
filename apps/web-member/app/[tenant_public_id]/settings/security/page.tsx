import { redirect } from "next/navigation";

import { requestPublicEmailChange } from "../../../../lib/auth";

const buildSettingsPath = (status: "success" | "error", message: string) => {
  const params = new URLSearchParams({ message, status });
  return `/settings/security?${params.toString()}`;
};

const requestEmailChangeAction = async (formData: FormData): Promise<void> => {
  "use server";

  const tenantPublicId = String(formData.get("tenantPublicId") ?? "").trim();
  const currentEmail = String(formData.get("currentEmail") ?? "").trim();
  const newEmail = String(formData.get("newEmail") ?? "").trim();
  const currentPassword = String(formData.get("currentPassword") ?? "");

  if (!currentEmail || !newEmail || !currentPassword) {
    redirect(buildSettingsPath("error", "入力内容を確認してください。"));
  }

  const requested = await requestPublicEmailChange(
    tenantPublicId,
    currentEmail,
    newEmail,
    currentPassword
  );
  if (!requested) {
    redirect(
      buildSettingsPath(
        "error",
        "メール変更リクエストに失敗しました。入力内容をご確認ください。"
      )
    );
  }

  redirect(
    buildSettingsPath(
      "success",
      "現在のメールアドレスと新しいメールアドレスの両方に確認メールを送信しました。両方のリンクを開いて変更を完了してください。"
    )
  );
};

export default async function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ tenant_public_id: string }>;
}) {
  const { tenant_public_id } = await params;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">メールアドレス変更</h2>
        <form action={requestEmailChangeAction} className="space-y-4">
          <input name="tenantPublicId" type="hidden" value={tenant_public_id} />

          <div className="space-y-2">
            <label htmlFor="currentEmail" className="text-sm font-medium">
              現在のメールアドレス
            </label>
            <input
              autoComplete="email"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              id="currentEmail"
              name="currentEmail"
              placeholder="current@example.com"
              required
              type="email"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="newEmail" className="text-sm font-medium">
              新しいメールアドレス
            </label>
            <input
              autoComplete="email"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              id="newEmail"
              name="newEmail"
              placeholder="new@example.com"
              required
              type="email"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="currentPassword" className="text-sm font-medium">
              現在のパスワード
            </label>
            <input
              autoComplete="current-password"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              id="currentPassword"
              name="currentPassword"
              placeholder="********"
              required
              type="password"
            />
            <p className="text-xs text-muted-foreground">
              セキュリティ上の理由から、パスワードの入力が必要です。
            </p>
          </div>

          <div className="flex justify-end">
            <button
              className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              type="submit"
            >
              確認メールを送信
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
