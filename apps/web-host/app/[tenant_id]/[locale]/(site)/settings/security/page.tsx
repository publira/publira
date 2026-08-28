import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { requestEmailChangeAction } from "./_lib/actions";

const fieldClassName =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

const EmailChangeSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const messages = await loadHostMessages(locale);

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">
        {getMessage(messages, "host.settings.email_change_heading")}
      </h2>
      <form action={requestEmailChangeAction} className="space-y-4">
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />

        <div className="space-y-2">
          <label htmlFor="currentEmail" className="text-sm font-medium">
            {getMessage(messages, "host.settings.email_current_label")}
          </label>
          <input
            autoComplete="email"
            className={fieldClassName}
            id="currentEmail"
            name="currentEmail"
            placeholder="current@example.com"
            required
            type="email"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="newEmail" className="text-sm font-medium">
            {getMessage(messages, "host.settings.email_new_label")}
          </label>
          <input
            autoComplete="email"
            className={fieldClassName}
            id="newEmail"
            name="newEmail"
            placeholder="new@example.com"
            required
            type="email"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="currentPassword" className="text-sm font-medium">
            {getMessage(messages, "host.settings.current_password_label")}
          </label>
          <input
            autoComplete="current-password"
            className={fieldClassName}
            id="currentPassword"
            name="currentPassword"
            placeholder="********"
            required
            type="password"
          />
          <p className="text-xs text-muted-foreground">
            {getMessage(messages, "host.settings.password_required_help")}
          </p>
        </div>

        <div className="flex justify-end">
          <button
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            type="submit"
          >
            {getMessage(messages, "host.settings.email_change_submit")}
          </button>
        </div>
      </form>
    </section>
  );
};

const EmailChangeSectionFallback = () => (
  <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <SkeletonLine className="mb-4 h-6 w-40" />
    <div className="h-64 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const SecuritySettingsPage = () => (
  <div className="space-y-6">
    <Suspense fallback={<EmailChangeSectionFallback />}>
      <EmailChangeSection />
    </Suspense>
  </div>
);

export default SecuritySettingsPage;
