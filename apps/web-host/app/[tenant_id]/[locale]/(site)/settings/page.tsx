import { getMessage, parseLocale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import { deleteMe, getMe } from "#lib/auth";
import {
  clearPublicSessionCookie,
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getLocale, loadHostMessages } from "#lib/locale";
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

  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = parseLocale(formData.get("locale"));
  const messages = await loadHostMessages(submittedLocale);
  const parsed = parseDeleteAccountForm(messages, formData);
  if (!parsed.success) {
    redirect(
      buildSettingsPath(
        submittedLocale,
        "error",
        toFormErrorMessage(parsed.error, { locale: submittedLocale })
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
        getMessage(messages, "host.settings.delete_failed")
      )
    );
  }

  await clearPublicSessionCookie();
  const params = new URLSearchParams({
    message: getMessage(messages, "host.settings.deleted"),
    status: "success",
  });
  redirect(`${withLocalePrefix(locale, "/login")}?${params.toString()}`);
};

const ProfileSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [me, messages] = await Promise.all([
    withPublicSessionReauth(locale, SETTINGS_RETURN_TO, () => getMe(tenantId)),
    loadHostMessages(locale),
  ]);
  const displayName = me?.name?.trim() ?? "";

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">
        {getMessage(messages, "host.settings.profile_heading")}
      </h2>
      <form action={updateProfileAction} className="space-y-4">
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />

        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {getMessage(messages, "host.settings.name_label")}
          </label>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            defaultValue={displayName}
            id="name"
            maxLength={100}
            minLength={1}
            name="name"
            placeholder={getMessage(messages, "host.settings.name_placeholder")}
            required
            type="text"
          />
          <p className="text-xs text-muted-foreground">
            {getMessage(messages, "host.settings.name_help")}
          </p>
        </div>

        <div className="flex justify-end">
          <button
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            type="submit"
          >
            {getMessage(messages, "host.settings.save")}
          </button>
        </div>
      </form>
    </section>
  );
};

const ProfileSectionFallback = () => (
  <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <SkeletonLine className="mb-4 h-6 w-32" />
    <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const DeleteSectionCopy = async () => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <DeleteAccountModal
      copy={{
        cancel: getMessage(messages, "host.settings.cancel"),
        confirmDescription: getMessage(
          messages,
          "host.settings.delete_confirm_description"
        ),
        confirmTitle: getMessage(
          messages,
          "host.settings.delete_confirm_title"
        ),
        open: getMessage(messages, "host.settings.delete_open"),
        passwordLabel: getMessage(
          messages,
          "host.settings.current_password_label"
        ),
        submit: getMessage(messages, "host.settings.delete_submit"),
      }}
      deleteAction={deleteAccountAction}
    />
  );
};

const DeleteSection = () => (
  <section className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 shadow-sm">
    <h2 className="mb-2 text-lg font-semibold text-destructive">
      <Suspense fallback={<SkeletonLine className="h-6 w-16" />}>
        <Message message="host.settings.delete_heading" />
      </Suspense>
    </h2>
    <p className="mb-4 text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="host.settings.delete_description" />
      </Suspense>
    </p>
    <div className="flex justify-end">
      <Suspense fallback={<SkeletonLine className="h-9 w-36" />}>
        <DeleteSectionCopy />
      </Suspense>
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
