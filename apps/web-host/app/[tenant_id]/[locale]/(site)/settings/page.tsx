import { toFormErrorMessage } from "@publira/utils/field-errors";
import { parseLocale } from "@publira/utils/i18n";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { deleteMe, getMe } from "#lib/auth";
import {
  clearPublicSessionCookie,
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { withLocalePrefix } from "#lib/locale-path";
import { getTenantId } from "#lib/tenant-id";

import { updateProfileAction } from "./_lib/actions";
import {
  buildSettingsPath,
  parseDeleteAccountForm,
} from "./_lib/settings-form";
import { DeleteAccountModal } from "./delete-account-modal";

const SETTINGS_RETURN_TO = "/settings";

const deleteAccountAction = async (formData: FormData): Promise<void> => {
  "use server";

  const parsed = parseDeleteAccountForm(formData);
  if (!parsed.success) {
    redirect(
      buildSettingsPath(
        parseLocale(formData.get("locale")),
        "error",
        toFormErrorMessage(parsed.error)
      )
    );
  }

  const { locale, password, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(locale, SETTINGS_RETURN_TO);
  // A wrong `password` is `invalid_argument` with a field violation, not
  // `unauthenticated`, so it stays a form error instead of ending the session.
  const deleted = await withPublicSessionReauth(
    locale,
    SETTINGS_RETURN_TO,
    () => deleteMe(tenantId, password, accessToken)
  );
  if (!deleted) {
    redirect(
      buildSettingsPath(
        locale,
        "error",
        "退会処理に失敗しました。入力内容をご確認ください。"
      )
    );
  }

  await clearPublicSessionCookie();
  redirect(
    `${withLocalePrefix(locale, "/login")}?message=アカウントを削除しました。ご利用ありがとうございました。&status=success`
  );
};

const ProfileSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const me = await withPublicSessionReauth(locale, SETTINGS_RETURN_TO, () =>
    getMe(tenantId)
  );
  const displayName = me?.name?.trim() ?? "";

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">プロフィール</h2>
      <form action={updateProfileAction} className="space-y-4">
        <LocaleField />
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
      <DeleteAccountModal deleteAction={deleteAccountAction} />
    </div>
  </section>
);

const BasicSettingsPage = () => (
  <div className="space-y-6">
    <Suspense fallback={<ProfileSectionFallback />}>
      <ProfileSection />
    </Suspense>
    <DeleteSection />
  </div>
);

export default BasicSettingsPage;
