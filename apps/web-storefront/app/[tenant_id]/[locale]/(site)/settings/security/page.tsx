import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import * as PasswordInput from "@publira/ui-components/password-input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate } from "@publira/utils";
import { cache, Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { listMyIdentities, listMyPasskeys } from "#lib/auth";
import { withPublicSessionReauth } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  SIGN_IN_PROVIDER_NAMES,
  SIGN_IN_PROVIDERS,
} from "#lib/sign-in-provider";
import { getTenantDisplayTimeZone, getTenantSignInClients } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import * as PasskeyConfirmation from "../_components/passkey-confirmation";
import { beginPasskeyConfirmationAction } from "../_lib/passkey-confirmation-actions";
import * as PasskeyAddition from "./_components/passkey-addition";
import {
  changePasswordAction,
  confirmEmailChangeWithProviderAction,
  linkIdentityAction,
  requestEmailChangeAction,
  requestEmailChangeWithPasskeyAction,
  unlinkIdentityAction,
} from "./_lib/actions";
import { deletePasskeyAction } from "./_lib/passkey-actions";
import { SECURITY_SETTINGS_RETURN_TO } from "./_lib/security-path";

const fieldClassName =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

const submitClassName =
  "inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90";

/**
 * Both forms here ask an account with a password for it, so the two fields
 * carry the same label. Naming each section after its heading is what tells
 * them apart: a reader moving by landmark hears which form they are in, and a
 * locator scoped to the region resolves where the label alone matches twice.
 */
const EMAIL_CHANGE_HEADING_ID = "email-change-heading";
const LINKED_ACCOUNTS_HEADING_ID = "linked-accounts-heading";
const PASSKEYS_HEADING_ID = "passkeys-heading";
const PASSWORD_CHANGE_HEADING_ID = "password-change-heading";

/**
 * The reader's providers and whether the account has a password, read once for
 * every section that asks.
 */
const readMyIdentities = cache((tenantId: string, locale: Locale) =>
  withPublicSessionReauth(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    () => listMyIdentities(tenantId),
    tenantId
  )
);

/**
 * Whether the account confirms with its password. A failed read leaves the
 * password forms, as it does for the deletion control.
 */
const readHasPassword = async (
  tenantId: string,
  locale: Locale
): Promise<boolean> => {
  const mine = await readMyIdentities(tenantId, locale);
  return mine?.hasPassword ?? true;
};

const EmailAddressFields = () => (
  <>
    <div className="space-y-2">
      <label htmlFor="currentEmail" className="text-sm font-medium">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="storefront.settings.email_current_label" />
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
          <Message message="storefront.settings.email_new_label" />
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
  </>
);

const PasswordEmailChangeForm = ({ tenantId }: { tenantId: string }) => (
  <form action={requestEmailChangeAction} className="space-y-4">
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />

    <EmailAddressFields />

    <div className="space-y-2">
      <label htmlFor="currentPassword" className="text-sm font-medium">
        <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
          <Message message="storefront.settings.current_password_label" />
        </Suspense>
      </label>
      <PasswordInput.Root>
        <PasswordInput.Control
          autoComplete="current-password"
          className={fieldClassName}
          id="currentPassword"
          name="currentPassword"
          placeholder="********"
          required
        />
        <PasswordInput.Toggle>
          <Suspense fallback={null}>
            <Message message="storefront.common.show_password" />
          </Suspense>
        </PasswordInput.Toggle>
      </PasswordInput.Root>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
          <Message message="storefront.settings.password_required_help" />
        </Suspense>
      </p>
    </div>

    <div className="flex justify-end">
      <button className={submitClassName} type="submit">
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="storefront.settings.email_change_submit" />
        </Suspense>
      </button>
    </div>
  </form>
);

/**
 * An account without a password confirms with one of its passkeys or a fresh
 * sign-in instead, to a linked provider the site can send the reader to. With
 * none of those, the reader is pointed at setting a password first.
 */
const PasswordlessEmailChangeForm = async ({
  locale,
  tenantId,
}: {
  locale: Locale;
  tenantId: string;
}) => {
  const [mine, clients] = await Promise.all([
    readMyIdentities(tenantId, locale),
    getTenantSignInClients(tenantId),
  ]);
  const linked = new Set(mine?.identities.map((identity) => identity.provider));
  const canConfirmWithApple = linked.has("apple") && Boolean(clients.apple);
  const canConfirmWithGoogle = linked.has("google") && Boolean(clients.google);
  const canConfirmWithPasskey = mine?.hasPasskey ?? false;
  if (!(canConfirmWithApple || canConfirmWithGoogle || canConfirmWithPasskey)) {
    return (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.settings.email_change_no_provider" />
        </Suspense>
      </p>
    );
  }

  return (
    <form action={confirmEmailChangeWithProviderAction} className="space-y-4">
      <LocaleField />
      <input name="tenantId" type="hidden" value={tenantId} />

      <input
        name="returnTo"
        type="hidden"
        value={SECURITY_SETTINGS_RETURN_TO}
      />

      <EmailAddressFields />

      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
          {canConfirmWithPasskey ? (
            <Message message="storefront.settings.email_change_confirm_with_passkey" />
          ) : (
            <Message message="storefront.settings.email_change_confirm_with_provider" />
          )}
        </Suspense>
      </p>

      <PasskeyConfirmation.Root
        begin={beginPasskeyConfirmationAction}
        confirm={requestEmailChangeWithPasskeyAction}
      >
        <div className="flex flex-wrap justify-end gap-2">
          {canConfirmWithPasskey ? (
            <PasskeyConfirmation.Submit className={submitClassName}>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="storefront.settings.email_change_with_passkey" />
              </Suspense>
            </PasskeyConfirmation.Submit>
          ) : null}
          {canConfirmWithApple ? (
            <button
              className={submitClassName}
              name="provider"
              type="submit"
              value="apple"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="storefront.settings.email_change_with_apple" />
              </Suspense>
            </button>
          ) : null}
          {canConfirmWithGoogle ? (
            <button
              className={submitClassName}
              name="provider"
              type="submit"
              value="google"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="storefront.settings.email_change_with_google" />
              </Suspense>
            </button>
          ) : null}
        </div>
        <PasskeyConfirmation.Message />
      </PasskeyConfirmation.Root>
    </form>
  );
};

const EmailChangeSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const hasPassword = await readHasPassword(tenantId, locale);

  return (
    <section
      aria-labelledby={EMAIL_CHANGE_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2 className="mb-4 text-lg font-semibold" id={EMAIL_CHANGE_HEADING_ID}>
        <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
          <Message message="storefront.settings.email_change_heading" />
        </Suspense>
      </h2>
      {hasPassword ? (
        <PasswordEmailChangeForm tenantId={tenantId} />
      ) : (
        <PasswordlessEmailChangeForm locale={locale} tenantId={tenantId} />
      )}
    </section>
  );
};

const EmailChangeSectionFallback = () => (
  <section className="space-y-4 border border-border bg-card p-6">
    <SkeletonLine className="mb-4 h-6 w-40" />
    <div className="h-64 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

/**
 * An account without a password has none to change. The reset flow sets a
 * first one through a link mailed to the account's address, so that is where
 * the reader is sent.
 */
const PasswordSetSection = () => (
  <section
    aria-labelledby={PASSWORD_CHANGE_HEADING_ID}
    className="border border-border bg-card p-6"
  >
    <h2 className="mb-2 text-lg font-semibold" id={PASSWORD_CHANGE_HEADING_ID}>
      <Suspense fallback={<SkeletonLine className="h-6 w-36" />}>
        <Message message="storefront.settings.password_set_heading" />
      </Suspense>
    </h2>
    <p className="mb-4 text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="storefront.settings.password_set_description" />
      </Suspense>
    </p>
    <div className="flex justify-end">
      <Suspense fallback={<SkeletonLine className="h-9 w-56" />}>
        <LocaleLink className={submitClassName} href="/reset-password">
          <Message message="storefront.settings.password_set_link" />
        </LocaleLink>
      </Suspense>
    </div>
  </section>
);

const PasswordChangeSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  if (!(await readHasPassword(tenantId, locale))) {
    return <PasswordSetSection />;
  }

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
          <Message message="storefront.settings.password_change_heading" />
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
              <Message message="storefront.settings.current_password_label" />
            </Suspense>
          </label>
          <PasswordInput.Root>
            <PasswordInput.Control
              autoComplete="current-password"
              className={fieldClassName}
              id="passwordChangeCurrent"
              name="currentPassword"
              placeholder="********"
              required
            />
            <PasswordInput.Toggle>
              <Suspense fallback={null}>
                <Message message="storefront.common.show_password" />
              </Suspense>
            </PasswordInput.Toggle>
          </PasswordInput.Root>
        </div>

        <div className="space-y-2">
          <label htmlFor="passwordChangeNew" className="text-sm font-medium">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="storefront.settings.password_new_label" />
            </Suspense>
          </label>
          <PasswordInput.Root>
            <PasswordInput.Control
              autoComplete="new-password"
              className={fieldClassName}
              id="passwordChangeNew"
              name="newPassword"
              placeholder="********"
              required
            />
            <PasswordInput.Toggle>
              <Suspense fallback={null}>
                <Message message="storefront.common.show_password" />
              </Suspense>
            </PasswordInput.Toggle>
          </PasswordInput.Root>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="passwordChangeConfirm"
            className="text-sm font-medium"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="storefront.settings.password_confirm_label" />
            </Suspense>
          </label>
          <PasswordInput.Root>
            <PasswordInput.Control
              autoComplete="new-password"
              className={fieldClassName}
              id="passwordChangeConfirm"
              name="confirmPassword"
              placeholder="********"
              required
            />
            <PasswordInput.Toggle>
              <Suspense fallback={null}>
                <Message message="storefront.common.show_password" />
              </Suspense>
            </PasswordInput.Toggle>
          </PasswordInput.Root>
        </div>

        <div className="flex justify-end">
          <button className={submitClassName} type="submit">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="storefront.settings.password_change_submit" />
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

const linkedAccountButtonClassName =
  "inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";

/**
 * The Apple and Google accounts the reader signs in with, and a way to link
 * each provider the tenant offers that the account has none of yet. Shown once
 * there is either to list. The last one of an account with neither a password
 * nor a passkey cannot be unlinked.
 */
const LinkedAccountsSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [mine, clients, t, timeZone] = await Promise.all([
    readMyIdentities(tenantId, locale),
    getTenantSignInClients(tenantId),
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);
  if (!mine) {
    return null;
  }
  const linked = new Map(
    mine.identities.map((identity) => [identity.provider, identity])
  );
  const providers = SIGN_IN_PROVIDERS.filter(
    (provider) => linked.has(provider) || Boolean(clients[provider])
  );
  if (providers.length === 0) {
    return null;
  }
  const keepsLast =
    !(mine.hasPassword || mine.hasPasskey) && mine.identities.length === 1;

  return (
    <section
      aria-labelledby={LINKED_ACCOUNTS_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2
        className="mb-2 text-lg font-semibold"
        id={LINKED_ACCOUNTS_HEADING_ID}
      >
        {t("storefront.settings.linked_accounts_heading")}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("storefront.settings.linked_accounts_description")}
      </p>
      <ul className="grid gap-4">
        {providers.map((provider) => {
          const identity = linked.get(provider);
          const name = SIGN_IN_PROVIDER_NAMES[provider];
          return (
            <li
              className="flex flex-wrap items-center justify-between gap-3"
              key={provider}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{name}</p>
                {identity ? (
                  <>
                    <p className="text-sm break-all text-muted-foreground">
                      {identity.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("storefront.settings.linked_account_linked_at", {
                        date: formatDate(identity.linkedAt, {
                          fallback: "-",
                          locale,
                          timeZone,
                        }),
                      })}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("storefront.settings.linked_account_not_linked")}
                  </p>
                )}
              </div>
              <form
                action={identity ? unlinkIdentityAction : linkIdentityAction}
              >
                <LocaleField />
                <input name="tenantId" type="hidden" value={tenantId} />
                <input name="provider" type="hidden" value={provider} />
                {identity ? (
                  <button
                    aria-label={t(
                      "storefront.settings.linked_account_unlink_aria",
                      { provider: name }
                    )}
                    className={linkedAccountButtonClassName}
                    disabled={keepsLast}
                    type="submit"
                  >
                    {t("storefront.settings.linked_account_unlink")}
                  </button>
                ) : (
                  <button
                    aria-label={t(
                      "storefront.settings.linked_account_link_aria",
                      { provider: name }
                    )}
                    className={linkedAccountButtonClassName}
                    type="submit"
                  >
                    {t("storefront.settings.linked_account_link")}
                  </button>
                )}
              </form>
            </li>
          );
        })}
      </ul>
      {keepsLast ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("storefront.settings.linked_account_last")}
        </p>
      ) : null}
    </section>
  );
};

const PasskeyAddStep = ({ tenantId }: { tenantId: string }) => (
  <PasskeyAddition.AddForm>
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <PasskeyAddition.Added />
    <div className="flex justify-end">
      <ActionForm.Submit variant="outline">
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="storefront.settings.passkey_add" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="storefront.settings.passkey_waiting" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </div>
  </PasskeyAddition.AddForm>
);

/**
 * Asks for a name for the passkey just added. It replaces the add form, so it
 * is also where the addition is reported.
 */
const PasskeyNameStep = ({ tenantId }: { tenantId: string }) => (
  <PasskeyAddition.NameForm>
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <PasskeyAddition.Named />
    <FormMessage variant="success">
      <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
        <Message message="storefront.settings.passkey_added" />
      </Suspense>
    </FormMessage>
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor="passkeyName">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="storefront.settings.passkey_name_label" />
        </Suspense>
      </label>
      <input
        autoComplete="off"
        className={fieldClassName}
        id="passkeyName"
        maxLength={64}
        name="name"
      />
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-3/4" />}>
          <Message message="storefront.settings.passkey_name_description" />
        </Suspense>
      </p>
    </div>
    <div className="flex flex-wrap justify-end gap-2">
      <PasskeyAddition.SkipNaming className={linkedAccountButtonClassName}>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="storefront.settings.passkey_name_skip" />
        </Suspense>
      </PasskeyAddition.SkipNaming>
      <ActionForm.Submit>
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="storefront.settings.save" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="storefront.settings.passkey_name_submitting" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </div>
  </PasskeyAddition.NameForm>
);

/**
 * The passkeys the reader signs in to the site with, each with when it was
 * added and last used, and the form that adds another. Shown whatever
 * providers the tenant offers, since a passkey needs nothing configured. The
 * last one of an account with neither a password nor a linked provider cannot
 * be removed.
 */
const PasskeysSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [mine, passkeys, t, timeZone] = await Promise.all([
    readMyIdentities(tenantId, locale),
    withPublicSessionReauth(
      locale,
      SECURITY_SETTINGS_RETURN_TO,
      () => listMyPasskeys(tenantId),
      tenantId
    ),
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);
  if (!passkeys) {
    return null;
  }
  const keepsLast =
    mine !== null &&
    !mine.hasPassword &&
    mine.identities.length === 0 &&
    passkeys.length === 1;
  const dates = { fallback: "-", locale, timeZone };

  return (
    <section
      aria-labelledby={PASSKEYS_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2 className="mb-2 text-lg font-semibold" id={PASSKEYS_HEADING_ID}>
        {t("storefront.settings.passkeys_heading")}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("storefront.settings.passkeys_description")}
      </p>
      {passkeys.length > 0 ? (
        <ul className="grid gap-4">
          {passkeys.map((passkey) => {
            const name =
              passkey.name || t("storefront.settings.passkey_unnamed");
            return (
              <li
                className="flex flex-wrap items-center justify-between gap-3"
                key={passkey.id}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("storefront.settings.passkey_added_at", {
                      date: formatDate(passkey.createdAt, dates),
                    })}
                    {" · "}
                    {passkey.lastUsedAt
                      ? t("storefront.settings.passkey_last_used_at", {
                          date: formatDate(passkey.lastUsedAt, dates),
                        })
                      : t("storefront.settings.passkey_never_used")}
                  </p>
                </div>
                <form action={deletePasskeyAction}>
                  <LocaleField />
                  <input name="tenantId" type="hidden" value={tenantId} />
                  <input name="passkeyId" type="hidden" value={passkey.id} />
                  <button
                    aria-label={t("storefront.settings.passkey_remove_aria", {
                      name,
                    })}
                    className={linkedAccountButtonClassName}
                    disabled={keepsLast}
                    type="submit"
                  >
                    {t("storefront.settings.passkey_remove")}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("storefront.settings.passkeys_empty")}
        </p>
      )}
      {keepsLast ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("storefront.settings.passkey_last")}
        </p>
      ) : null}
      <div className="mt-4">
        <PasskeyAddition.Root
          add={<PasskeyAddStep tenantId={tenantId} />}
          name={<PasskeyNameStep tenantId={tenantId} />}
        />
      </div>
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
      <PasskeysSection />
    </Suspense>
    <Suspense fallback={null}>
      <LinkedAccountsSection />
    </Suspense>
  </div>
);

export default SecuritySettingsPage;
