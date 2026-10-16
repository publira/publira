import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenHeader,
  AuthScreenMain,
  AuthScreenTagline,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import {
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import {
  PasswordInput,
  PasswordInputControl,
  PasswordInputToggle,
} from "@publira/ui-components/password-input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SocialSignInButtons } from "#components/social-sign-in-buttons";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { TenantIdField } from "#components/tenant-id-field";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { PasskeySignIn } from "./_components/passkey-sign-in";
import { loginAction } from "./_lib/actions";
import { parseLoginSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.auth.login.title") };
};

/**
 * Cache Components streams the static shell first. An operable fallback form
 * would submit `returnTo="/"` before `searchParams` resolve.
 */
const LoginFormSkeleton = () => (
  <>
    <AuthScreenBody>
      <div className="grid gap-2">
        <SkeletonLine className="h-4 w-28" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="grid gap-2">
        <SkeletonLine className="h-4 w-24" />
        <Skeleton className="h-10 w-full" />
      </div>
      <Skeleton className="h-9 w-32" />
    </AuthScreenBody>
    <AuthScreenFooter>
      <SkeletonLine className="h-4 w-40" />
      <SkeletonLine className="h-4 w-56" />
    </AuthScreenFooter>
  </>
);

/**
 * The form itself. Only `returnTo` and the flash messages depend on the query,
 * so nothing here resolves a catalog: each string is a `<Message>` behind the
 * boundary sized for it, and the tenant id and locale ride in through the
 * hidden fields that already exist for a Server Action.
 */
const LoginForm = ({
  errorMessage,
  resetDone,
  returnToPath,
  sessionRevoked,
}: {
  errorMessage?: string;
  resetDone?: boolean;
  returnToPath: string;
  sessionRevoked?: boolean;
}) => (
  <>
    <AuthScreenBody>
      <form action={loginAction} className="grid gap-4">
        <LocaleField />
        <TenantIdField />
        <input name="returnTo" type="hidden" value={returnToPath} />

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="storefront.auth.fields.email_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="username webauthn"
              name="email"
              placeholder="your@email.com"
              required
              type="email"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="storefront.auth.fields.password_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <PasswordInput>
              <PasswordInputControl
                autoComplete="current-password"
                name="password"
                placeholder="••••••••"
                required
              />
              <PasswordInputToggle>
                <Suspense fallback={null}>
                  <Message message="storefront.common.show_password" />
                </Suspense>
              </PasswordInputToggle>
            </PasswordInput>
          </FieldContent>
        </Field>

        {sessionRevoked ? (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <Message message="storefront.auth.login.session_revoked" />
            </Suspense>
          </FormMessage>
        ) : null}

        {errorMessage ? (
          <FormMessage variant="destructive">{errorMessage}</FormMessage>
        ) : null}

        {resetDone ? (
          <FormMessage variant="success">
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <Message message="storefront.auth.login.reset_done" />
            </Suspense>
          </FormMessage>
        ) : null}

        <Button className="justify-self-start" type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="storefront.auth.login.submit" />
          </Suspense>
        </Button>
      </form>

      <Suspense fallback={null}>
        <SocialSignInButtons returnTo={returnToPath}>
          <PasskeySignIn>
            <LocaleField />
            <TenantIdField />
            <input name="returnTo" type="hidden" value={returnToPath} />
            <ActionFormSubmit className="w-full" variant="outline">
              <ActionFormIdle>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="storefront.auth.login.passkey_submit" />
                </Suspense>
              </ActionFormIdle>
              <ActionFormPending>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="storefront.auth.login.passkey_pending" />
                </Suspense>
              </ActionFormPending>
            </ActionFormSubmit>
          </PasskeySignIn>
        </SocialSignInButtons>
      </Suspense>
    </AuthScreenBody>

    <AuthScreenFooter>
      <p>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-40" />}>
          <LocaleLink
            href="/reset-password"
            className="text-primary underline underline-offset-4"
          >
            <Message message="storefront.auth.login.forgot_password" />
          </LocaleLink>
        </Suspense>
      </p>
      <p className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message message="storefront.auth.login.no_account" />
        </Suspense>{" "}
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-12" />}>
          <LocaleLink
            href="/signup"
            className="text-primary underline underline-offset-4"
          >
            <Message message="storefront.auth.login.signup" />
          </LocaleLink>
        </Suspense>
      </p>
    </AuthScreenFooter>
  </>
);

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

/** The tenant's own name and tagline, which only the site read can supply. */
const LoginHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [info, siteLabel, t] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);
  const siteTagline = info?.siteTagline?.trim();

  return (
    <>
      <TenantDocumentTitle
        pageTitle={t("storefront.auth.login.title")}
        siteLabel={siteLabel}
      />
      <AuthScreenTitle>{siteLabel}</AuthScreenTitle>
      {siteTagline ? (
        <AuthScreenTagline>{siteTagline}</AuthScreenTagline>
      ) : null}
    </>
  );
};

const LoginPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/login">) => (
  <AuthScreen>
    <AuthScreenMain>
      <AuthScreenHeader>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <LoginHeader />
        </Suspense>
      </AuthScreenHeader>

      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginFormContent searchParams={searchParams} />
      </Suspense>
    </AuthScreenMain>
  </AuthScreen>
);

export default LoginPage;
