import { updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { deleteMe, getMe, updateMe } from "#lib/auth";
import {
  getPublicSessionCacheTag,
  PUBLIC_SESSION_COOKIE_NAME,
} from "#lib/auth-shared";

import { DeleteAccountModal } from "./delete-account-modal";
import { getTenantId } from "#lib/tenant-id";

const buildSettingsPath = (status: "success" | "error", message: string) => {
  const params = new URLSearchParams({ message, status });
  return `/settings?${params.toString()}`;
};

const sessionCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

const clearSessionCookie = async () => {
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions,
    expires: new Date(0),
    name: PUBLIC_SESSION_COOKIE_NAME,
    value: "",
  });
};

const updateProfileAction = async (formData: FormData): Promise<void> => {
  "use server";

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    redirect(buildSettingsPath("error", "表示名を入力してください。"));
  }

  if (name.length > 100) {
    redirect(
      buildSettingsPath("error", "表示名は100文字以内で入力してください。")
    );
  }

  const updated = await updateMe(tenantId, name);
  if (!updated) {
    redirect(
      buildSettingsPath(
        "error",
        "プロフィールの更新に失敗しました。時間をおいて再度お試しください。"
      )
    );
  }

  redirect(buildSettingsPath("success", "プロフィールを更新しました。"));
};

const deleteAccountAction = async (formData: FormData): Promise<void> => {
  "use server";

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();

  if (!password) {
    redirect(
      buildSettingsPath("error", "退会には現在のパスワード入力が必要です。")
    );
  }

  const deleted = await deleteMe(tenantId, password);
  if (!deleted) {
    redirect(
      buildSettingsPath(
        "error",
        "退会処理に失敗しました。入力内容をご確認ください。"
      )
    );
  }

  await clearSessionCookie();
  updateTag(getPublicSessionCacheTag(PUBLIC_SESSION_COOKIE_NAME));
  redirect(
    "/login?message=アカウントを削除しました。ご利用ありがとうございました。&status=success"
  );
};

const ProfileSection = async () => {
  const tenantId = await getTenantId();
  const me = await getMe(tenantId);
  const displayName = me?.name?.trim() ?? "";

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">プロフィール</h2>
      <form action={updateProfileAction} className="space-y-4">
        <input name="tenantId" type="hidden" value={tenantId} />

        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            表示名
          </label>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            defaultValue={displayName}
            id="name"
            maxLength={100}
            minLength={1}
            name="name"
            placeholder="表示名を入力"
            required
            type="text"
          />
          <p className="text-xs text-muted-foreground">
            この名前はプロフィールに表示されます。
          </p>
        </div>

        <div className="flex justify-end">
          <button
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            type="submit"
          >
            保存
          </button>
        </div>
      </form>
    </section>
  );
};

const ProfileSectionFallback = () => (
  <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <h2 className="mb-4 text-lg font-semibold">プロフィール</h2>
    <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const DeleteSection = () => (
  <section className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 shadow-sm">
    <h2 className="mb-2 text-lg font-semibold text-destructive">退会</h2>
    <p className="mb-4 text-sm text-muted-foreground">
      退会するとアカウント情報にアクセスできなくなります。この操作は取り消せません。実行前にご注意ください。
    </p>
    <div className="flex justify-end">
      <DeleteAccountModal
        deleteAction={deleteAccountAction}
      />
    </div>
  </section>
);

export default async function BasicSettingsPage({
  params,
}: {
  params: Promise<{ tenant_id: string }>;
}) {

  return (
    <div className="space-y-6">
      <Suspense fallback={<ProfileSectionFallback />}>
        <ProfileSection />
      </Suspense>
      <DeleteSection />
    </div>
  );
}
