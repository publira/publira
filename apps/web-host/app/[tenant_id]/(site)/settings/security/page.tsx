import { getTenantId } from "#lib/tenant-id";

import { requestEmailChangeAction } from "./_lib/actions";

const SecuritySettingsPage = async () => {
  const tenantId = await getTenantId();

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">メールアドレス変更</h2>
        <form action={requestEmailChangeAction} className="space-y-4">
          <input name="tenantId" type="hidden" value={tenantId} />

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
};

export default SecuritySettingsPage;
