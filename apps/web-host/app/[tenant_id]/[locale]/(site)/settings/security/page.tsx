import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate } from "@publira/utils";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import { listMyIdentities } from "#lib/auth";
import { withPublicSessionReauth } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { SIGN_IN_PROVIDER_NAMES } from "#lib/sign-in-provider";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  changePasswordAction,
  requestEmailChangeAction,
  unlinkIdentityAction,
} from "./_lib/actions";

const fieldClassName =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

const submitClassName =
  "inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90";

/**
 * Both forms here ask for the account's current password, so the two fields
 * carry the same label. Naming each section after its heading is what tells
 * them apart: a reader moving by landmark hears which form they are in, and a
 * locator scoped to the region resolves where the label alone matches twice.
 */
const EMAIL_CHANGE_HEADING_ID = "email-change-heading";
const LINKED_ACCOUNTS_HEADING_ID = "linked-accounts-heading";
const PASSWORD_CHANGE_HEADING_ID = "password-change-heading";

const EmailChangeSection = async () => {
  const tenantId = await getTenantId();

  return (
    <section
      aria-labelledby={EMAIL_CHANGE_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2 className="mb-4 text-lg font-semibold" id={EMAIL_CHANGE_HEADING_ID}>
        <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
          <Message message="host.settings.email_change_heading" />
        </Suspense>
      </h2>
      <form action={requestEmailChangeAction} className="space-y-4">
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />

        <div className="space-y-2">
          <label htmlFor="currentEmail" className="text-sm font-medium">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="host.settings.email_current_label" />
            </Suspense>
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
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="host.settings.email_new_label" />
            </Suspense>
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
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="host.settings.current_password_label" />
            </Suspense>
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
            <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
              <Message message="host.settings.password_required_help" />
            </Suspense>
          </p>
        </div>

        <div className="flex justify-end">
          <button className={submitClassName} type="submit">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="host.settings.email_change_submit" />
            </Suspense>
          </button>
        </div>
      </form>
    </section>
  );
};

const EmailChangeSectionFallback = () => (
  <section className="space-y-4 border border-border bg-card p-6">
    <SkeletonLine className="mb-4 h-6 w-40" />
    <div className="h-64 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const PasswordChangeSection = async () => {
  const tenantId = await getTenantId();

  return (
    <section
      aria-labelledby={PASSWORD_CHANGE_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2
        className="mb-4 text-lg font-semibold"
        id={PASSWORD_CHANGE_HEADING_ID}
      >
        <Suspense fallback={<SkeletonLine className="h-6 w-36" />}>
          <Message message="host.settings.password_change_heading" />
        </Suspense>
      </h2>
      <form action={changePasswordAction} className="space-y-4">
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />

        <div className="space-y-2">
          <label
            htmlFor="passwordChangeCurrent"
            className="text-sm font-medium"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="host.settings.current_password_label" />
            </Suspense>
          </label>
          <input
            autoComplete="current-password"
            className={fieldClassName}
            id="passwordChangeCurrent"
            name="currentPassword"
            placeholder="********"
            required
            type="password"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="passwordChangeNew" className="text-sm font-medium">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="host.settings.password_new_label" />
            </Suspense>
          </label>
          <input
            autoComplete="new-password"
            className={fieldClassName}
            id="passwordChangeNew"
            name="newPassword"
            placeholder="********"
            required
            type="password"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="passwordChangeConfirm"
            className="text-sm font-medium"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="host.settings.password_confirm_label" />
            </Suspense>
          </label>
          <input
            autoComplete="new-password"
            className={fieldClassName}
            id="passwordChangeConfirm"
            name="confirmPassword"
            placeholder="********"
            required
            type="password"
          />
        </div>

        <div className="flex justify-end">
          <button className={submitClassName} type="submit">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="host.settings.password_change_submit" />
            </Suspense>
          </button>
        </div>
      </form>
    </section>
  );
};

const PasswordChangeSectionFallback = () => (
  <section className="space-y-4 border border-border bg-card p-6">
    <SkeletonLine className="mb-4 h-6 w-36" />
    <div className="h-56 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

/**
 * The Apple and Google accounts the reader signs in with, once one is linked.
 * The last one of an account without a password cannot be unlinked.
 */
const LinkedAccountsSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [mine, t, timeZone] = await Promise.all([
    withPublicSessionReauth(
      locale,
      "/settings/security",
      () => listMyIdentities(tenantId),
      tenantId
    ),
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);
  if (!mine || mine.identities.length === 0) {
    return null;
  }
  const keepsLast = !mine.hasPassword && mine.identities.length === 1;

  return (
    <section
      aria-labelledby={LINKED_ACCOUNTS_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2
        className="mb-2 text-lg font-semibold"
        id={LINKED_ACCOUNTS_HEADING_ID}
      >
        {t("host.settings.linked_accounts_heading")}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("host.settings.linked_accounts_description")}
      </p>
      <ul className="grid gap-4">
        {mine.identities.map((identity) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3"
            key={identity.provider}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {SIGN_IN_PROVIDER_NAMES[identity.provider]}
              </p>
              <p className="text-sm break-all text-muted-foreground">
                {identity.email}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("host.settings.linked_account_linked_at", {
                  date: formatDate(identity.linkedAt, {
                    fallback: "-",
                    locale,
                    timeZone,
                  }),
                })}
              </p>
            </div>
            <form action={unlinkIdentityAction}>
              <LocaleField />
              <input name="tenantId" type="hidden" value={tenantId} />
              <input name="provider" type="hidden" value={identity.provider} />
              <button
                aria-label={t("host.settings.linked_account_unlink_aria", {
                  provider: SIGN_IN_PROVIDER_NAMES[identity.provider],
                })}
                className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                disabled={keepsLast}
                type="submit"
              >
                {t("host.settings.linked_account_unlink")}
              </button>
            </form>
          </li>
        ))}
      </ul>
      {keepsLast ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("host.settings.linked_account_last")}
        </p>
      ) : null}
    </section>
  );
};

const SecuritySettingsPage = () => (
  <div className="space-y-6">
    <Suspense fallback={<EmailChangeSectionFallback />}>
      <EmailChangeSection />
    </Suspense>
    <Suspense fallback={<PasswordChangeSectionFallback />}>
      <PasswordChangeSection />
    </Suspense>
    <Suspense fallback={null}>
      <LinkedAccountsSection />
    </Suspense>
  </div>
);

export default SecuritySettingsPage;
