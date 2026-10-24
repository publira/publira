import * as AuthScreen from "@publira/layouts/auth-screen";
import { Button } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import * as PasswordInput from "@publira/ui-components/password-input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { TenantIdField } from "#components/tenant-id-field";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantSiteCopy, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { confirmPasswordAction } from "./_lib/actions";
import { parseConfirmPasswordSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.auth.confirm_password.title") };
};

/**
 * Cache Components streams the static shell first. An operable fallback
 * with `token=""` would submit an empty token, or flash the invalid-link
 * copy, before `searchParams` resolve.
 */
const ConfirmPasswordFormSkeleton = () => (
  <>
    <AuthScreen.Body>
      <div className="grid gap-2">
        <SkeletonLine className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="grid gap-2">
        <SkeletonLine className="h-4 w-44" />
        <Skeleton className="h-10 w-full" />
      </div>
      <Skeleton className="h-9 w-40" />
    </AuthScreen.Body>
    <AuthScreen.Footer>
      <SkeletonLine className="h-4 w-40" />
    </AuthScreen.Footer>
  </>
);

/** A link that carried no token, and the screen that can issue a fresh one. */
const ConfirmPasswordInvalidLink = () => (
  <>
    <AuthScreen.Body>
      <AuthScreen.Text>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.auth.confirm_password.invalid" />
        </Suspense>
      </AuthScreen.Text>
    </AuthScreen.Body>
    <AuthScreen.Footer>
      <p>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-40" />}>
          <LocaleLink
            className="text-primary underline underline-offset-4"
            href="/reset-password"
          >
            <Message message="storefront.auth.confirm_password.to_reset_password" />
          </LocaleLink>
        </Suspense>
      </p>
    </AuthScreen.Footer>
  </>
);

/**
 * Only the token and the rejected-submission message come from the query, so
 * the form resolves no catalog of its own: every string is a `<Message>` behind
 * the boundary sized for it.
 */
const ConfirmPasswordForm = ({
  token,
  errorMessage,
}: {
  token: string;
  errorMessage?: string;
}) => (
  <>
    <AuthScreen.Body>
      <form action={confirmPasswordAction} className="grid gap-4">
        <LocaleField />
        <TenantIdField />
        <input name="token" type="hidden" value={token} />

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="storefront.auth.confirm_password.password_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <PasswordInput.Root>
              <PasswordInput.Control
                autoComplete="new-password"
                name="newPassword"
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

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
              <Message message="storefront.auth.confirm_password.password_confirm_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <PasswordInput.Root>
              <PasswordInput.Control
                autoComplete="new-password"
                name="confirmPassword"
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

        {errorMessage ? (
          <FormMessage variant="destructive">{errorMessage}</FormMessage>
        ) : null}

        <Button className="justify-self-start" type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="storefront.auth.confirm_password.submit" />
          </Suspense>
        </Button>
      </form>
    </AuthScreen.Body>

    <AuthScreen.Footer>
      <p>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-32" />}>
          <LocaleLink
            className="text-primary underline underline-offset-4"
            href="/login"
          >
            <Message message="storefront.auth.fields.to_login" />
          </LocaleLink>
        </Suspense>
      </p>
    </AuthScreen.Footer>
  </>
);

const ConfirmPasswordFormContent = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/confirm-password">["searchParams"];
}) => {
  const { errorMessage, token } = parseConfirmPasswordSearchParams(
    await searchParams
  );

  if (!token) {
    return <ConfirmPasswordInvalidLink />;
  }

  return <ConfirmPasswordForm errorMessage={errorMessage} token={token} />;
};

/** The tenant's own name and tagline, which only the site read can supply. */
const ConfirmPasswordHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [{ siteTagline }, siteLabel, t] = await Promise.all([
    getTenantSiteCopy(tenantId, locale),
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);

  return (
    <>
      <TenantDocumentTitle
        pageTitle={t("storefront.auth.confirm_password.title")}
        siteLabel={siteLabel}
      />
      <AuthScreen.Title>{siteLabel}</AuthScreen.Title>
      {siteTagline ? (
        <AuthScreen.Tagline>{siteTagline}</AuthScreen.Tagline>
      ) : null}
    </>
  );
};

const ConfirmPasswordPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/confirm-password">) => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <ConfirmPasswordHeader />
        </Suspense>
      </AuthScreen.Header>

      <Suspense fallback={<ConfirmPasswordFormSkeleton />}>
        <ConfirmPasswordFormContent searchParams={searchParams} />
      </Suspense>
    </AuthScreen.Main>
  </AuthScreen.Root>
);

export default ConfirmPasswordPage;
