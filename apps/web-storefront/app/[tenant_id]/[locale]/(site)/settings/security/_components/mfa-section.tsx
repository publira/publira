import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import * as PasswordInput from "@publira/ui-components/password-input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate } from "@publira/utils";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import type { MyIdentities } from "#lib/auth";
import { withPublicSessionReauth } from "#lib/auth-session";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getMyMfaStatus } from "#lib/mfa";
import type { MfaCodeAccepts } from "#lib/mfa-refusal-message";
import { getTenantDisplayTimeZone, getTenantSignInClients } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import * as PasskeyConfirmation from "../../_components/passkey-confirmation";
import { beginPasskeyConfirmationAction } from "../../_lib/passkey-confirmation-actions";
import {
  confirmMfaEnrollmentAction,
  disableMfaAction,
  disableMfaWithPasskeyAction,
  disableMfaWithProviderAction,
  regenerateMfaRecoveryCodesAction,
  startMfaEnrollmentAction,
} from "../_lib/mfa-actions";
import { SECURITY_SETTINGS_RETURN_TO } from "../_lib/security-path";
import * as MfaSettings from "./mfa-settings";

const MFA_HEADING_ID = "two-step-verification-heading";

const providerButtonClassName =
  "inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";

/** `placeholder` is an attribute rather than a node, so the input waits for the catalog alone. */
const MfaCodeInput = async ({ accepts }: { accepts: MfaCodeAccepts }) => {
  const t = await getMessages();

  return (
    <Input
      autoComplete="one-time-code"
      // A recovery code carries letters and a separator, so the numeric
      // keypad is only right where the authenticator is the only source.
      inputMode={accepts === "authenticator" ? "numeric" : "text"}
      name="code"
      placeholder={
        accepts === "authenticator"
          ? t("storefront.auth.two_step.code_placeholder")
          : undefined
      }
      required
      spellCheck={false}
      type="text"
    />
  );
};

/** The one code field every form here has, with what it takes. */
const MfaCodeField = ({ accepts }: { accepts: MfaCodeAccepts }) => (
  <Field.Root>
    <Field.Label required>
      <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
        <Message message="storefront.auth.two_step.code_label" />
      </Suspense>
    </Field.Label>
    <Field.Content>
      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <MfaCodeInput accepts={accepts} />
      </Suspense>
      <Field.Description>
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          {accepts === "authenticator" ? (
            <Message message="storefront.settings.mfa_code_help" />
          ) : (
            <Message message="storefront.settings.mfa_code_or_recovery_help" />
          )}
        </Suspense>
      </Field.Description>
    </Field.Content>
  </Field.Root>
);

const MfaStartForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm.Root
    action={startMfaEnrollmentAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <MfaSettings.EnrollmentStarted />
    <div className="flex justify-end">
      <ActionForm.Submit>
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.settings.mfa_enable" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.settings.mfa_enable_starting" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

const MfaConfirmForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm.Root
    action={confirmMfaEnrollmentAction}
    className="grid gap-4"
    showSuccess={false}
  >
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <MfaSettings.Report />
    <MfaSettings.EnrollmentSecret />
    <ActionForm.Fieldset>
      <MfaCodeField accepts="authenticator" />
    </ActionForm.Fieldset>
    <div className="flex justify-end">
      <ActionForm.Submit>
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="storefront.settings.mfa_confirm" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.settings.mfa_confirming" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

const MfaRegenerateForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm.Root
    action={regenerateMfaRecoveryCodesAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <MfaSettings.Report />
    <div className="grid gap-1">
      <h3 className="text-sm font-medium">
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="storefront.settings.mfa_regenerate_heading" />
        </Suspense>
      </h3>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="storefront.settings.mfa_regenerate_description" />
        </Suspense>
      </p>
    </div>
    <ActionForm.Fieldset>
      <MfaCodeField accepts="authenticator" />
    </ActionForm.Fieldset>
    <div className="flex justify-end">
      <ActionForm.Submit variant="outline">
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="storefront.settings.mfa_regenerate" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.settings.mfa_regenerating" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

const MfaDisableHeading = () => (
  <div className="grid gap-1">
    <h3 className="text-sm font-medium">
      <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
        <Message message="storefront.settings.mfa_disable_heading" />
      </Suspense>
    </h3>
    <p className="text-xs text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
        <Message message="storefront.settings.mfa_disable_description" />
      </Suspense>
    </p>
  </div>
);

/** Turning it off with the account's password and a code. */
const MfaDisableWithPasswordForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm.Root action={disableMfaAction} className="grid gap-3">
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <MfaDisableHeading />
    <ActionForm.Fieldset className="grid gap-4">
      <Field.Root>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
            <Message message="storefront.settings.current_password_label" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <PasswordInput.Root>
            <PasswordInput.Control
              autoComplete="current-password"
              name="password"
              placeholder="••••••••"
              required
            />
            <PasswordInput.Toggle>
              <Suspense fallback={null}>
                <Message message="storefront.common.show_password" />
              </Suspense>
            </PasswordInput.Toggle>
          </PasswordInput.Root>
        </Field.Content>
      </Field.Root>
      <MfaCodeField accepts="authenticator_or_recovery" />
    </ActionForm.Fieldset>
    <div className="flex justify-end">
      <ActionForm.Submit variant="destructive">
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.settings.mfa_disable" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.settings.mfa_disabling" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

/**
 * Turning it off for an account without a password, which confirms with one
 * of its passkeys or a fresh sign-in to a linked provider the site can send
 * the reader to, as an email change does. With none of those, the reader is
 * pointed at setting a password first.
 */
const MfaDisableWithoutPasswordForm = async ({
  mine,
  tenantId,
}: {
  mine: MyIdentities;
  tenantId: string;
}) => {
  const clients = await getTenantSignInClients(tenantId);
  const linked = new Set(mine.identities.map((identity) => identity.provider));
  const canConfirmWithApple = linked.has("apple") && Boolean(clients.apple);
  const canConfirmWithGoogle = linked.has("google") && Boolean(clients.google);
  const canConfirmWithPasskey = mine.hasPasskey;

  if (!(canConfirmWithApple || canConfirmWithGoogle || canConfirmWithPasskey)) {
    return (
      <div className="grid gap-3">
        <MfaDisableHeading />
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="storefront.settings.mfa_disable_no_confirmation" />
          </Suspense>
        </p>
      </div>
    );
  }

  return (
    <form action={disableMfaWithProviderAction} className="grid gap-3">
      <LocaleField />
      <input name="tenantId" type="hidden" value={tenantId} />
      <input
        name="returnTo"
        type="hidden"
        value={SECURITY_SETTINGS_RETURN_TO}
      />
      <MfaDisableHeading />
      <MfaCodeField accepts="authenticator_or_recovery" />
      <PasskeyConfirmation.Root
        begin={beginPasskeyConfirmationAction}
        confirm={disableMfaWithPasskeyAction}
      >
        <div className="flex flex-wrap justify-end gap-2">
          {canConfirmWithPasskey ? (
            <PasskeyConfirmation.Submit className={providerButtonClassName}>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="storefront.settings.mfa_disable_with_passkey" />
              </Suspense>
            </PasskeyConfirmation.Submit>
          ) : null}
          {canConfirmWithApple ? (
            <button
              className={providerButtonClassName}
              name="provider"
              type="submit"
              value="apple"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="storefront.settings.mfa_disable_with_apple" />
              </Suspense>
            </button>
          ) : null}
          {canConfirmWithGoogle ? (
            <button
              className={providerButtonClassName}
              name="provider"
              type="submit"
              value="google"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="storefront.settings.mfa_disable_with_google" />
              </Suspense>
            </button>
          ) : null}
        </div>
        <PasskeyConfirmation.Message />
      </PasskeyConfirmation.Root>
    </form>
  );
};

/** The authenticator is on: when it was set up, and what keeps it. */
const MfaEnabled = async ({
  enabledAt,
  locale,
  mine,
  remainingRecoveryCodes,
  tenantId,
}: {
  enabledAt: string;
  locale: Locale;
  /** `null` when the read failed, which leaves the password form. */
  mine: MyIdentities | null;
  remainingRecoveryCodes: number;
  tenantId: string;
}) => {
  const [t, timeZone] = await Promise.all([
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  return (
    <>
      <div className="grid gap-1">
        <p className="text-sm">
          {t("storefront.settings.mfa_status_enabled", {
            date: formatDate(enabledAt, { fallback: "-", locale, timeZone }),
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("storefront.settings.mfa_remaining_recovery_codes", {
            count: remainingRecoveryCodes,
          })}
        </p>
      </div>
      <MfaRegenerateForm tenantId={tenantId} />
      {mine === null || mine.hasPassword ? (
        <MfaDisableWithPasswordForm tenantId={tenantId} />
      ) : (
        <MfaDisableWithoutPasswordForm mine={mine} tenantId={tenantId} />
      )}
    </>
  );
};

/**
 * **Two-step verification**: the authenticator app the reader is asked for a
 * code from after their password, or after signing in with Apple or Google.
 * One authenticator serves the site, the app, and the tenant's console.
 *
 * `readMyIdentities` is the page's read of whether the account has a password
 * and what else it can confirm with, shared with the other sections.
 */
export const MfaSection = async ({
  readMyIdentities,
}: {
  readMyIdentities: (
    tenantId: string,
    locale: Locale
  ) => Promise<MyIdentities | null>;
}) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [status, mine, t] = await Promise.all([
    withPublicSessionReauth(
      locale,
      SECURITY_SETTINGS_RETURN_TO,
      () => getMyMfaStatus(tenantId),
      tenantId
    ),
    readMyIdentities(tenantId, locale),
    getMessagesFor(locale),
  ]);

  if (!status) {
    return null;
  }

  return (
    <section
      aria-labelledby={MFA_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2 className="mb-2 text-lg font-semibold" id={MFA_HEADING_ID}>
        {t("storefront.settings.mfa_heading")}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("storefront.settings.mfa_description")}
      </p>
      <div className="grid gap-6">
        <MfaSettings.Outcome>
          {status.enabled ? (
            <MfaEnabled
              enabledAt={status.enabledAt}
              locale={locale}
              mine={mine}
              remainingRecoveryCodes={status.remainingRecoveryCodes}
              tenantId={tenantId}
            />
          ) : (
            <>
              <p className="text-sm">
                {t("storefront.settings.mfa_status_disabled")}
              </p>
              <MfaSettings.Enrollment
                confirm={<MfaConfirmForm tenantId={tenantId} />}
                start={<MfaStartForm tenantId={tenantId} />}
              />
            </>
          )}
        </MfaSettings.Outcome>
      </div>
    </section>
  );
};
