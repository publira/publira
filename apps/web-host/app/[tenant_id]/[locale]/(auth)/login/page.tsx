import { getMessage } from "@publira/i18n";
import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Skeleton } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { loginAction } from "./_lib/actions";
import { parseLoginSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.auth.login.title") };
};

/**
 * Cache Components streams the static shell first. An operable fallback form
 * would submit `returnTo="/"` before `searchParams` resolve (#994).
 */
const LoginFormSkeleton = () => (
  <>
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="mt-2 h-10 w-full" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-4 w-40" />
      </div>
    </div>
    <div className="mt-4 flex justify-center">
      <Skeleton className="h-4 w-56" />
    </div>
  </>
);

/**
 * The form already waits on `searchParams`, so it resolves the catalog itself
 * rather than giving each label its own boundary: nothing here can reach the
 * static shell, and `placeholder` could not stream in any case.
 */
const LoginForm = async ({
  errorMessage,
  resetDone,
  returnToPath,
  sessionRevoked,
}: {
  errorMessage?: string;
  resetDone?: boolean;
  returnToPath: string;
  sessionRevoked?: boolean;
}) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const messages = await loadHostMessages(locale);

  return (
    <>
      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <form action={loginAction} className="space-y-4">
          <LocaleField />
          <input name="tenantId" type="hidden" value={tenantId} />
          <input name="returnTo" type="hidden" value={returnToPath} />

          <Field>
            <FieldLabel htmlFor="email" required>
              {getMessage(messages, "host.auth.fields.email_label")}
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="email"
                id="email"
                name="email"
                placeholder="your@email.com"
                required
                type="email"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="password" required>
              {getMessage(messages, "host.auth.fields.password_label")}
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="current-password"
                id="password"
                name="password"
                placeholder="••••••••"
                required
                type="password"
              />
            </FieldContent>
          </Field>

          {sessionRevoked ? (
            <FormMessage variant="destructive">
              {getMessage(messages, "host.auth.login.session_revoked")}
            </FormMessage>
          ) : null}

          {errorMessage ? (
            <FormMessage variant="destructive">{errorMessage}</FormMessage>
          ) : null}

          {resetDone ? (
            <FormMessage variant="success">
              {getMessage(messages, "host.auth.login.reset_done")}
            </FormMessage>
          ) : null}

          <Button className="mt-2 w-full" type="submit">
            {getMessage(messages, "host.auth.login.submit")}
          </Button>
        </form>

        <div className="text-right text-sm">
          <LocaleLink
            href="/reset-password"
            className="font-medium text-primary hover:underline"
          >
            {getMessage(messages, "host.auth.login.forgot_password")}
          </LocaleLink>
        </div>
      </div>

      <div className="mt-4 text-center text-sm">
        <span className="text-muted-foreground">
          {getMessage(messages, "host.auth.login.no_account")}
        </span>{" "}
        <LocaleLink
          href="/signup"
          className="font-medium text-primary hover:underline"
        >
          {getMessage(messages, "host.auth.login.signup")}
        </LocaleLink>
      </div>
    </>
  );
};

const LoginFormContent = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/login">["searchParams"];
}) => {
  const { errorMessage, resetDone, returnToPath, sessionRevoked } =
    parseLoginSearchParams(await searchParams);

  return (
    <LoginForm
      errorMessage={errorMessage}
      resetDone={resetDone}
      returnToPath={returnToPath}
      sessionRevoked={sessionRevoked}
    />
  );
};

const LoginPageContent = async ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/login">) => {
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
          pageTitle={getMessage(messages, "host.auth.login.title")}
          siteLabel={siteLabel}
        />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </div>
      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginFormContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
};

const LoginPageFallback = () => (
  <div className="w-full max-w-sm">
    <div className="mb-8 flex justify-center">
      <Skeleton className="h-8 w-40" />
    </div>
    <LoginFormSkeleton />
  </div>
);

const LoginPage = ({
  params,
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/login">) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent params={params} searchParams={searchParams} />
    </Suspense>
  </main>
);

export default LoginPage;
