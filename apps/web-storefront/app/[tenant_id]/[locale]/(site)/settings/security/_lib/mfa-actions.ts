"use server";

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toQrCodePath } from "@publira/ui-components/qr-code";
import { toFormDataInput } from "@publira/utils/form-data";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { AccountConfirmation } from "#lib/auth";
import {
  passkeyCredentialFormSchema,
  passwordFormSchema,
  tenantIdSchema,
} from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import type { StorefrontMessageAccessor } from "#lib/messages";
import {
  confirmMyMfaEnrollment,
  disableMyMfa,
  isMfaSetUpInConsoleError,
  regenerateMyMfaRecoveryCodes,
  startMyMfaEnrollment,
} from "#lib/mfa";
import type { MfaChangeOutcome } from "#lib/mfa";
import {
  mfaDisableRefusalMessage,
  mfaRefusalMessage,
} from "#lib/mfa-refusal-message";
import type { MfaCodeAccepts } from "#lib/mfa-refusal-message";
import { SIGN_IN_PROVIDERS } from "#lib/sign-in-provider";
import { sendToProvider } from "#lib/social-sign-in-start";

import type {
  MfaEnrollmentStartState,
  MfaSettingsChangeState,
} from "./mfa-state";
import {
  buildSecuritySettingsPath,
  SECURITY_SETTINGS_RETURN_TO,
} from "./security-path";

/**
 * A code as a form submits it. A recovery code is ten characters with a
 * separator, so anything far longer came from neither source.
 */
const mfaCodeFormSchema = z.string().trim().min(1).max(64);

const mfaFormSchema = z.object({
  locale: localeFormSchema,
  tenantId: tenantIdSchema,
});

const mfaCodeSchema = mfaFormSchema.extend({ code: mfaCodeFormSchema });

/** The session these Actions run as, signing the reader in again without one. */
const requireSession = (locale: Locale, tenantId: string) =>
  requirePublicSession(locale, SECURITY_SETTINGS_RETURN_TO, tenantId);

/** Run a change, turning a session the API rejects into a fresh sign-in. */
const withSession = <T>(
  locale: Locale,
  tenantId: string,
  run: () => Promise<T>
): Promise<T> =>
  withPublicSessionReauth(locale, SECURITY_SETTINGS_RETURN_TO, run, tenantId);

/**
 * The wording of a refused change: a refused code as the code step words it,
 * and anything else as `fallback`, or `precondition` for a failed one.
 */
const mfaChangeRefusalMessage = (
  t: StorefrontMessageAccessor,
  locale: Locale,
  refusal: Extract<MfaChangeOutcome, { ok: false }>,
  copy: {
    accepts: MfaCodeAccepts;
    fallback: string;
    precondition?: string;
  }
): string => {
  if ("code" in refusal) {
    return mfaRefusalMessage(t, refusal.code, copy.accepts);
  }

  return rpcErrorMessage(refusal.error, copy.fallback, {
    locale,
    overrides: copy.precondition
      ? { precondition: copy.precondition }
      : undefined,
  });
};

/**
 * Start setting an authenticator up. The secret comes back for the confirm
 * step to show as a QR code and as a key to type, and nothing changes on the
 * account until a code from it confirms it.
 */
export const startMfaEnrollmentAction = async (
  _prevState: MfaEnrollmentStartState,
  formData: FormData
): Promise<MfaEnrollmentStartState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  const parsed = mfaFormSchema.safeParse(
    toFormDataInput(formData, { locale: "value", tenantId: "value" })
  );

  if (!parsed.success) {
    return { message: t("storefront.settings.mfa_enable_failed"), ok: false };
  }

  const { locale, tenantId } = parsed.data;
  const accessToken = await requireSession(locale, tenantId);

  const started = await withSession(locale, tenantId, () =>
    startMyMfaEnrollment(tenantId, accessToken)
  );

  if (!started.ok) {
    return {
      message:
        "error" in started && isMfaSetUpInConsoleError(started.error)
          ? t("storefront.settings.mfa_set_up_in_console")
          : mfaChangeRefusalMessage(t, locale, started, {
              accepts: "authenticator",
              fallback: t("storefront.settings.mfa_enable_failed"),
            }),
      ok: false,
    };
  }

  return {
    message: "",
    ok: true,
    qr: toQrCodePath(started.otpauthUri),
    secret: started.secret,
  };
};

/**
 * Confirm the authenticator with a code from it, which turns two-step
 * verification on. The recovery codes come back for the section to show once,
 * and the section is read again so it shows the forms that keep the factor.
 */
export const confirmMfaEnrollmentAction = async (
  _prevState: MfaSettingsChangeState,
  formData: FormData
): Promise<MfaSettingsChangeState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  const parsed = mfaCodeSchema.safeParse(
    toFormDataInput(formData, {
      code: "value",
      locale: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    return { message: t("storefront.auth.two_step.code_required"), ok: false };
  }

  const { code, locale, tenantId } = parsed.data;
  const accessToken = await requireSession(locale, tenantId);

  const confirmed = await withSession(locale, tenantId, () =>
    confirmMyMfaEnrollment(tenantId, code, accessToken)
  );

  if (!confirmed.ok) {
    return {
      message:
        "error" in confirmed && isMfaSetUpInConsoleError(confirmed.error)
          ? t("storefront.settings.mfa_set_up_in_console")
          : mfaChangeRefusalMessage(t, locale, confirmed, {
              accepts: "authenticator",
              fallback: t("storefront.settings.mfa_enable_failed"),
            }),
      ok: false,
    };
  }

  refresh();

  return {
    message: t("storefront.settings.mfa_enabled"),
    ok: true,
    recoveryCodes: confirmed.recoveryCodes,
  };
};

/**
 * Replace every recovery code, confirmed with a code from the authenticator.
 * The new batch comes back for the section to show once.
 */
export const regenerateMfaRecoveryCodesAction = async (
  _prevState: MfaSettingsChangeState,
  formData: FormData
): Promise<MfaSettingsChangeState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  const parsed = mfaCodeSchema.safeParse(
    toFormDataInput(formData, {
      code: "value",
      locale: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    return { message: t("storefront.auth.two_step.code_required"), ok: false };
  }

  const { code, locale, tenantId } = parsed.data;
  const accessToken = await requireSession(locale, tenantId);

  const regenerated = await withSession(locale, tenantId, () =>
    regenerateMyMfaRecoveryCodes(tenantId, code, accessToken)
  );

  if (!regenerated.ok) {
    return {
      message: mfaChangeRefusalMessage(t, locale, regenerated, {
        accepts: "authenticator",
        fallback: t("storefront.settings.mfa_regenerate_failed"),
      }),
      ok: false,
    };
  }

  refresh();

  return {
    message: t("storefront.settings.mfa_regenerated"),
    ok: true,
    recoveryCodes: regenerated.recoveryCodes,
  };
};

/**
 * Turn two-step verification off with `confirmation` and a code, and go back
 * to the section, which then offers to turn it on. A refusal comes back as the
 * message for the form to show.
 */
const disableWith = async (
  t: StorefrontMessageAccessor,
  locale: Locale,
  tenantId: string,
  code: string,
  confirmation: AccountConfirmation
): Promise<ActionForm.State> => {
  const accessToken = await requireSession(locale, tenantId);

  const disabled = await withSession(locale, tenantId, () =>
    disableMyMfa(tenantId, code, confirmation, accessToken)
  );

  if (!disabled.ok) {
    return {
      message: mfaDisableRefusalMessage(
        t,
        locale,
        disabled,
        "password" in confirmation ? "password" : "fresh_sign_in"
      ),
      ok: false,
    };
  }

  redirect(
    await buildSecuritySettingsPath(
      locale,
      tenantId,
      "success",
      t("storefront.settings.mfa_disabled")
    )
  );
};

const disableWithPasswordFormSchema = async (locale: Locale) =>
  mfaCodeSchema.extend({ password: await passwordFormSchema(locale) });

/** Turn two-step verification off with the account's password and a code. */
export const disableMfaAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));

  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    disableWithPasswordFormSchema(submittedLocale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      code: "value",
      locale: "value",
      password: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    return { message: t("storefront.settings.mfa_disable_failed"), ok: false };
  }

  const { code, locale, password, tenantId } = parsed.data;

  return disableWith(t, locale, tenantId, code, { password });
};

const disableWithPasskeySchema = mfaCodeSchema.extend({
  passkeyCredential: passkeyCredentialFormSchema,
});

/**
 * Turn two-step verification off for an account without a password, with an
 * assertion one of its passkeys made and a code. A refusal stays on the form,
 * beside the button the reader can try again with.
 */
export const disableMfaWithPasskeyAction = async (
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  const parsed = disableWithPasskeySchema.safeParse(
    toFormDataInput(formData, {
      code: "value",
      locale: "value",
      passkeyCredential: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    return { message: t("storefront.settings.mfa_disable_failed"), ok: false };
  }

  const { code, locale, passkeyCredential, tenantId } = parsed.data;

  return disableWith(t, locale, tenantId, code, { passkeyCredential });
};

const disableWithProviderSchema = mfaCodeSchema.extend({
  provider: z.enum(SIGN_IN_PROVIDERS),
});

/**
 * Turn two-step verification off for an account without a password, which
 * signs in again with the provider whose button the reader pressed. The code
 * waits with the sign-in, and the callback sends both.
 */
export const disableMfaWithProviderAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  // A form that names no tenant did not come from the section, and nothing
  // can be built for it to go back to without one: it is turned away as it is.
  const tenant = tenantIdSchema.safeParse(
    toFormDataInput(formData, { tenantId: "value" }).tenantId
  );

  if (!tenant.success) {
    return;
  }

  const parsed = disableWithProviderSchema.safeParse(
    toFormDataInput(formData, {
      code: "value",
      locale: "value",
      provider: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    redirect(
      await buildSecuritySettingsPath(
        submittedLocale,
        tenant.data,
        "error",
        t("storefront.settings.mfa_disable_failed")
      )
    );
  }

  const { code, locale, provider, tenantId } = parsed.data;
  const accessToken = await requireSession(locale, tenantId);

  await sendToProvider({
    accessToken,
    intent: "mfa_disable",
    locale,
    mfaCode: code,
    provider,
    returnTo: SECURITY_SETTINGS_RETURN_TO,
    tenantId,
  });
};
