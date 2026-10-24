import * as AuthScreen from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import * as PasswordInput from "@publira/ui-components/password-input";
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
import { getTenantSiteCopy, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { PasskeySignIn } from "./_components/passkey-sign-in";
import {
  RefusedSignUpNotice,
  SignUpPrompt,
} from "./_components/sign-up-prompt";
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
    <AuthScreen.Body>
      <div className="grid gap-2">
        <SkeletonLine className="h-4 w-28" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="grid gap-2">
        <SkeletonLine className="h-4 w-24" />
        <Skeleton className="h-10 w-full" />
      </div>
      <Skeleton className="h-9 w-32" />
    </AuthScreen.Body>
    <AuthScreen.Footer>
      <SkeletonLine className="h-4 w-40" />
      <SkeletonLine className="h-4 w-56" />
    </AuthScreen.Footer>
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
  signUpClosed,
}: {
  errorMessage?: string;
  resetDone?: boolean;
  returnToPath: string;
  sessionRevoked?: boolean;
  signUpClosed?: boolean;
}) => (
  <>
    <AuthScreen.Body>
      {signUpClosed ? (
        <Suspense fallback={<Skeleton className="h-16 w-full" />}>
          <RefusedSignUpNotice />
        </Suspense>
      ) : null}

      <form action={loginAction} className="grid gap-4">
        <LocaleField />
        <TenantIdField />
        <input name="returnTo" type="hidden" value={returnToPath} />

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="storefront.auth.fields.email_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              autoComplete="username webauthn"
              name="email"
              placeholder="your@email.com"
              required
              type="email"
            />
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="storefront.auth.fields.password_label" />
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
            <ActionForm.Submit className="w-full" variant="outline">
              <ActionForm.Idle>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="storefront.auth.login.passkey_submit" />
                </Suspense>
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="storefront.auth.login.passkey_pending" />
                </Suspense>
              </ActionForm.Pending>
            </ActionForm.Submit>
          </PasskeySignIn>
        </SocialSignInButtons>
      </Suspense>
    </AuthScreen.Body>

    <AuthScreen.Footer>
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
      <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
        <SignUpPrompt refused={signUpClosed === true} />
      </Suspense>
    </AuthScreen.Footer>
  </>
);

const LoginFormContent = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/login">["searchParams"];
}) => {
  const {
    errorMessage,
    resetDone,
    returnToPath,
    sessionRevoked,
    signUpClosed,
  } = parseLoginSearchParams(await searchParams);

  return (
    <LoginForm
      errorMessage={errorMessage}
      resetDone={resetDone}
      returnToPath={returnToPath}
      sessionRevoked={sessionRevoked}
      signUpClosed={signUpClosed}
    />
  );
};

/** The tenant's own name and tagline, which only the site read can supply. */
const LoginHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [{ siteTagline }, siteLabel, t] = await Promise.all([
    getTenantSiteCopy(tenantId, locale),
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);

  return (
    <>
      <TenantDocumentTitle
        pageTitle={t("storefront.auth.login.title")}
        siteLabel={siteLabel}
      />
      <AuthScreen.Title>{siteLabel}</AuthScreen.Title>
      {siteTagline ? (
        <AuthScreen.Tagline>{siteTagline}</AuthScreen.Tagline>
      ) : null}
    </>
  );
};

const LoginPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/login">) => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <LoginHeader />
        </Suspense>
      </AuthScreen.Header>

      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginFormContent searchParams={searchParams} />
      </Suspense>
    </AuthScreen.Main>
  </AuthScreen.Root>
);

export default LoginPage;
