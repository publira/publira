import { getMessage } from "@publira/i18n";
import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Skeleton } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { confirmPasswordAction } from "./_lib/actions";
import { parseConfirmPasswordSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.auth.confirm_password.title") };
};

/**
 * Cache Components streams the static shell first. An operable fallback
 * with `token=""` would submit an empty token, or flash the invalid-link
 * copy, before `searchParams` resolve (#994).
 */
const ConfirmPasswordFormSkeleton = () => (
  <>
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="mt-2 h-10 w-full" />
      </div>
    </div>
    <div className="mt-4 flex justify-center">
      <Skeleton className="h-4 w-40" />
    </div>
  </>
);

/**
 * The form already waits on `searchParams` — the token decides whether it is
 * rendered at all — so it resolves the catalog itself instead of giving each
 * label its own boundary.
 */
const ConfirmPasswordForm = async ({
  token,
  errorMessage,
}: {
  token: string;
  errorMessage?: string;
}) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const messages = await loadHostMessages(locale);

  if (!token) {
    return (
      <>
        <section className="space-y-3 text-sm leading-6">
          <p>{getMessage(messages, "host.auth.fields.invalid_token")}</p>
        </section>
        <div className="text-center text-sm">
          <LocaleLink
            href="/reset-password"
            className="font-medium text-primary hover:underline"
          >
            {getMessage(
              messages,
              "host.auth.confirm_password.to_reset_password"
            )}
          </LocaleLink>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <form action={confirmPasswordAction} className="space-y-4">
          <LocaleField />
          <input name="tenantId" type="hidden" value={tenantId} />
          <input name="token" type="hidden" value={token} />

          <Field>
            <FieldLabel htmlFor="newPassword" required>
              {getMessage(
                messages,
                "host.auth.confirm_password.password_label"
              )}
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="new-password"
                id="newPassword"
                name="newPassword"
                placeholder="••••••••"
                required
                type="password"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="confirmPassword" required>
              {getMessage(
                messages,
                "host.auth.confirm_password.password_confirm_label"
              )}
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="new-password"
                id="confirmPassword"
                name="confirmPassword"
                placeholder="••••••••"
                required
                type="password"
              />
            </FieldContent>
          </Field>

          {errorMessage ? (
            <FormMessage variant="destructive">{errorMessage}</FormMessage>
          ) : null}

          <Button className="mt-2 w-full" type="submit">
            {getMessage(messages, "host.auth.confirm_password.submit")}
          </Button>
        </form>
      </div>

      <div className="mt-4 text-center text-sm">
        <LocaleLink
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          {getMessage(messages, "host.auth.fields.to_login")}
        </LocaleLink>
      </div>
    </>
  );
};

const ConfirmPasswordFormContent = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/confirm-password">["searchParams"];
}) => {
  await connection();

  const { errorMessage, token } = parseConfirmPasswordSearchParams(
    await searchParams
  );

  return <ConfirmPasswordForm errorMessage={errorMessage} token={token} />;
};

const ConfirmPasswordPageContent = async ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/confirm-password">) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [info, siteLabel, messages] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);
  const siteTagline = info?.siteTagline?.trim();

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <TenantDocumentTitle
          pageTitle={getMessage(messages, "host.auth.confirm_password.title")}
          siteLabel={siteLabel}
        />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </div>
      <Suspense fallback={<ConfirmPasswordFormSkeleton />}>
        <ConfirmPasswordFormContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
};

const ConfirmPasswordPageFallback = () => (
  <div className="w-full max-w-sm">
    <div className="mb-8 flex justify-center">
      <Skeleton className="h-8 w-40" />
    </div>
    <ConfirmPasswordFormSkeleton />
  </div>
);

const ConfirmPasswordPage = ({
  params,
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/confirm-password">) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <Suspense fallback={<ConfirmPasswordPageFallback />}>
      <ConfirmPasswordPageContent params={params} searchParams={searchParams} />
    </Suspense>
  </main>
);

export default ConfirmPasswordPage;
