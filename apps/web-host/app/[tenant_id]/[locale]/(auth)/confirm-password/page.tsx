import { getMessage } from "@publira/i18n";
import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenHeader,
  AuthScreenTagline,
  AuthScreenText,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { TenantIdField } from "#components/tenant-id-field";
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
 * copy, before `searchParams` resolve.
 */
const ConfirmPasswordFormSkeleton = () => (
  <>
    <AuthScreenBody>
      <div className="grid gap-2">
        <SkeletonLine className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="grid gap-2">
        <SkeletonLine className="h-4 w-44" />
        <Skeleton className="h-10 w-full" />
      </div>
      <Skeleton className="h-9 w-40" />
    </AuthScreenBody>
    <AuthScreenFooter>
      <SkeletonLine className="h-4 w-40" />
    </AuthScreenFooter>
  </>
);

/** A link that carried no token, and the screen that can issue a fresh one. */
const ConfirmPasswordInvalidLink = () => (
  <>
    <AuthScreenBody>
      <AuthScreenText>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.auth.fields.invalid_token" />
        </Suspense>
      </AuthScreenText>
    </AuthScreenBody>
    <AuthScreenFooter>
      <p>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-40" />}>
          <LocaleLink
            className="text-primary underline underline-offset-4"
            href="/reset-password"
          >
            <Message message="host.auth.confirm_password.to_reset_password" />
          </LocaleLink>
        </Suspense>
      </p>
    </AuthScreenFooter>
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
    <AuthScreenBody>
      <form action={confirmPasswordAction} className="grid gap-4">
        <LocaleField />
        <TenantIdField />
        <input name="token" type="hidden" value={token} />

        <Field>
          <FieldLabel htmlFor="newPassword" required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="host.auth.confirm_password.password_label" />
            </Suspense>
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
            <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
              <Message message="host.auth.confirm_password.password_confirm_label" />
            </Suspense>
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

        <Button className="justify-self-start" type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="host.auth.confirm_password.submit" />
          </Suspense>
        </Button>
      </form>
    </AuthScreenBody>

    <AuthScreenFooter>
      <p>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-32" />}>
          <LocaleLink
            className="text-primary underline underline-offset-4"
            href="/login"
          >
            <Message message="host.auth.fields.to_login" />
          </LocaleLink>
        </Suspense>
      </p>
    </AuthScreenFooter>
  </>
);

const ConfirmPasswordFormContent = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/confirm-password">["searchParams"];
}) => {
  await connection();

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
  const [info, siteLabel, messages] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);
  const siteTagline = info?.siteTagline?.trim();

  return (
    <>
      <TenantDocumentTitle
        pageTitle={getMessage(messages, "host.auth.confirm_password.title")}
        siteLabel={siteLabel}
      />
      <AuthScreenTitle>{siteLabel}</AuthScreenTitle>
      {siteTagline ? (
        <AuthScreenTagline>{siteTagline}</AuthScreenTagline>
      ) : null}
    </>
  );
};

const ConfirmPasswordPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/confirm-password">) => (
  <AuthScreen>
    <AuthScreenHeader>
      <Suspense fallback={<Skeleton className="h-8 w-40" />}>
        <ConfirmPasswordHeader />
      </Suspense>
    </AuthScreenHeader>

    <Suspense fallback={<ConfirmPasswordFormSkeleton />}>
      <ConfirmPasswordFormContent searchParams={searchParams} />
    </Suspense>
  </AuthScreen>
);

export default ConfirmPasswordPage;
