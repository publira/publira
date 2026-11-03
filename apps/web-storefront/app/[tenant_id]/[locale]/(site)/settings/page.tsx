import type { Locale } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate, formatPlainDate } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { deleteMe, getMe, listMyIdentities } from "#lib/auth";
import {
  clearPublicSessionCookie,
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getMyDataExport } from "#lib/data-export";
import { getLocale } from "#lib/locale";
import { requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import {
  getTenantReaderIconChoice,
  offersReaderIconField,
} from "#lib/reader-icon-policy";
import {
  getTenantAgeVerification,
  getTenantDisplayTimeZone,
  getTenantSignInClients,
} from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";
import { tenantLocalePath } from "#lib/tenant-locale-path";

import { AccountIconField } from "./_components/account-icon-field";
import { updateProfileAction } from "./_lib/actions";
import { requestDataExportAction } from "./_lib/data-export-actions";
import {
  buildSettingsPath,
  parseDeleteAccountForm,
} from "./_lib/settings-form";
import { DeleteAccountModal } from "./delete-account-modal";

const SETTINGS_RETURN_TO = "/settings";

/**
 * The Route Handler that streams the reader's archive. It sits outside the
 * locale tree, so the language a refusal is worded in goes in the query. The
 * link is a plain navigation: the archive arrives as an attachment and the
 * sign-in redirect as a page, which a `download` attribute would save as a
 * file instead.
 */
const DATA_EXPORT_DOWNLOAD_PATH = "/api/v1/my/data-export";

const DATA_EXPORT_HEADING_ID = "data-export-heading";

const deleteAccountAction = async (formData: FormData): Promise<void> => {
  "use server";

  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));

  const [t, parsed] = await Promise.all([
    getMessagesFor(submittedLocale),
    parseDeleteAccountForm(submittedLocale, formData),
  ]);

  if (!parsed.success) {
    const errorPath = await buildSettingsPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      "error",
      toFormErrorMessage(parsed.error, { locale: submittedLocale })
    );

    redirect(errorPath);
  }

  const { locale, password, tenantId } = parsed.data;

  const accessToken = await requirePublicSession(
    locale,
    SETTINGS_RETURN_TO,
    tenantId
  );

  // A wrong `password` is `invalid_argument` with a field violation, not
  // `unauthenticated`, so it stays a form error instead of ending the session.
  const outcome = await withPublicSessionReauth(
    locale,
    SETTINGS_RETURN_TO,
    () => deleteMe(tenantId, { password }, accessToken),
    tenantId
  );

  if (outcome !== "deleted") {
    const errorPath = await buildSettingsPath(
      locale,
      tenantId,
      "error",
      t(
        outcome === "last_tenant_admin"
          ? "storefront.settings.delete_last_tenant_admin"
          : "storefront.settings.delete_failed"
      )
    );

    redirect(errorPath);
  }

  await clearPublicSessionCookie();

  const params = new URLSearchParams({
    message: t("storefront.settings.deleted"),
    status: "success",
  });

  const loginPath = await tenantLocalePath(tenantId, locale, "/login");
  redirect(`${loginPath}?${params.toString()}`);
};

/**
 * The birth date the account carries, which is written once: a stored date is
 * shown back rather than offered for editing, and the input appears only where
 * the tenant checks ages and the reader has given none.
 */
const BirthDateRow = async ({
  birthDate,
  locale,
  tenantId,
}: {
  birthDate: string;
  locale: Locale;
  tenantId: string;
}) => {
  const [ageVerification, t] = await Promise.all([
    getTenantAgeVerification(tenantId),
    getMessagesFor(locale),
  ]);

  if (birthDate) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">
          {t("storefront.settings.birth_date_label")}
        </p>
        <p className="text-sm tabular-nums">
          {formatPlainDate(birthDate, { locale })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("storefront.settings.birth_date_set_help")}{" "}
          <LocaleLink
            className="text-primary underline underline-offset-4"
            href="/contact"
          >
            {t("storefront.settings.birth_date_contact")}
          </LocaleLink>
        </p>
      </div>
    );
  }

  if (ageVerification === "none") {
    return null;
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor="birthDate">
        {t("storefront.settings.birth_date_label")}
      </label>
      <input
        autoComplete="bday"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        id="birthDate"
        name="birthDate"
        type="date"
      />
      <p className="text-xs text-muted-foreground">
        {t("storefront.settings.birth_date_help")}
      </p>
    </div>
  );
};

const ProfileSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [me, t, iconChoice] = await Promise.all([
    withPublicSessionReauth(
      locale,
      SETTINGS_RETURN_TO,
      () => getMe(tenantId),
      tenantId
    ),
    getMessagesFor(locale),
    getTenantReaderIconChoice(tenantId),
  ]);

  const displayName = me?.name?.trim() ?? "";
  const icon = me?.icon ?? null;

  return (
    <section className="border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">
        {t("storefront.settings.profile_heading")}
      </h2>
      {/* Saved as soon as it changes, so it stands outside the form's Save. */}
      {offersReaderIconField(iconChoice, icon !== null) ? (
        <div className="mb-6">
          <AccountIconField
            choice={iconChoice}
            icon={icon}
            iconPresetId={me?.iconPresetId ?? null}
            locale={locale}
            tenantId={tenantId}
          />
        </div>
      ) : null}
      <form action={updateProfileAction} className="space-y-4">
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />

        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("storefront.settings.name_label")}
          </label>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            defaultValue={displayName}
            id="name"
            maxLength={100}
            minLength={1}
            name="name"
            placeholder={t("storefront.settings.name_placeholder")}
            required
            type="text"
          />
          <p className="text-xs text-muted-foreground">
            {t("storefront.settings.name_help")}
          </p>
        </div>

        <BirthDateRow
          birthDate={me?.birthDate.trim() ?? ""}
          locale={locale}
          tenantId={tenantId}
        />

        <div className="flex justify-end">
          <button
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            type="submit"
          >
            {t("storefront.settings.save")}
          </button>
        </div>
      </form>
    </section>
  );
};

const ProfileSectionFallback = () => (
  <section className="space-y-4 border border-border bg-card p-6">
    <SkeletonLine className="mb-4 h-6 w-32" />
    <div className="flex items-center gap-4">
      <Skeleton className="size-20 rounded-full" />
      <Skeleton className="h-8 w-32 pointer-coarse:h-11" />
    </div>
    <Skeleton className="h-10 w-full" />
  </section>
);

/**
 * The deletion control with the confirmation the account can give. A failed
 * read leaves the password form.
 */
const DeleteAccountControl = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [mine, clients] = await Promise.all([
    withPublicSessionReauth(
      locale,
      SETTINGS_RETURN_TO,
      () => listMyIdentities(tenantId),
      tenantId
    ),
    getTenantSignInClients(tenantId),
  ]);

  const linked = new Set(mine?.identities.map((identity) => identity.provider));

  return (
    <DeleteAccountModal
      canConfirmWithApple={linked.has("apple") && Boolean(clients.apple)}
      canConfirmWithGoogle={linked.has("google") && Boolean(clients.google)}
      canConfirmWithPasskey={mine?.hasPasskey ?? false}
      deleteAction={deleteAccountAction}
      hasPassword={mine?.hasPassword ?? true}
    />
  );
};

/** The form that asks for an archive, under the label its state gives it. */
const RequestDataExportForm = ({
  children,
  tenantId,
  variant,
}: {
  children: string;
  tenantId: string;
  variant?: "outline";
}) => (
  <form action={requestDataExportAction}>
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <Button type="submit" variant={variant}>
      {children}
    </Button>
  </form>
);

/**
 * Where the reader's latest request for their archive stands: nothing asked
 * for yet, being prepared, or ready to download until the day it is deleted.
 * A ready archive can be asked for again, for a copy of what has changed
 * since; one being prepared cannot, since the API refuses a second request
 * while one is open.
 */
const DataExportControl = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [dataExport, t, timeZone] = await Promise.all([
    withPublicSessionReauth(
      locale,
      SETTINGS_RETURN_TO,
      () => getMyDataExport(tenantId),
      tenantId
    ),
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (dataExport?.state === "pending") {
    return (
      <p className="text-sm">{t("storefront.settings.data_export_pending")}</p>
    );
  }

  if (dataExport?.state === "ready") {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          {t("storefront.settings.data_export_ready", {
            date: formatDate(dataExport.expiresAt, {
              fallback: "-",
              locale,
              timeZone,
            }),
          })}
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <RequestDataExportForm tenantId={tenantId} variant="outline">
            {t("storefront.settings.data_export_request_again")}
          </RequestDataExportForm>
          <LinkButton
            href={`${DATA_EXPORT_DOWNLOAD_PATH}?${new URLSearchParams({ locale })}`}
          >
            {t("storefront.settings.data_export_download")}
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {dataExport?.state === "failed" ? (
        <p className="text-sm">{t("storefront.settings.data_export_failed")}</p>
      ) : null}
      <div className="flex justify-end">
        <RequestDataExportForm tenantId={tenantId}>
          {t("storefront.settings.data_export_request")}
        </RequestDataExportForm>
      </div>
    </div>
  );
};

const DataExportSection = () => (
  <section
    aria-labelledby={DATA_EXPORT_HEADING_ID}
    className="border border-border bg-card p-6"
  >
    <h2 className="mb-2 text-lg font-semibold" id={DATA_EXPORT_HEADING_ID}>
      <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
        <Message message="storefront.settings.data_export_heading" />
      </Suspense>
    </h2>
    <p className="mb-4 text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="storefront.settings.data_export_description" />
      </Suspense>
    </p>
    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
          <Message message="storefront.settings.data_export_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<SkeletonLine className="h-9 w-full" />}>
        <DataExportControl />
      </Suspense>
    </SectionErrorBoundary>
  </section>
);

const DeleteSection = () => (
  <section className="border border-destructive/40 bg-destructive/5 p-6">
    <h2 className="mb-2 text-lg font-semibold text-destructive">
      <Suspense fallback={<SkeletonLine className="h-6 w-16" />}>
        <Message message="storefront.settings.delete_heading" />
      </Suspense>
    </h2>
    <p className="mb-4 text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="storefront.settings.delete_description" />
      </Suspense>
    </p>
    <div className="flex justify-end">
      <Suspense fallback={<SkeletonLine className="h-9 w-36" />}>
        <DeleteAccountControl />
      </Suspense>
    </div>
  </section>
);

const BasicSettingsPage = () => (
  <div className="space-y-6">
    <Suspense fallback={<ProfileSectionFallback />}>
      <ProfileSection />
    </Suspense>
    <DataExportSection />
    <DeleteSection />
  </div>
);

export default BasicSettingsPage;
