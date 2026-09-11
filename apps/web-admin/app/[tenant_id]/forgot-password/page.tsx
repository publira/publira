import { getMessage } from "@publira/i18n";
import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenHeader,
  AuthScreenNote,
  AuthScreenTagline,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { requestPasswordResetAction } from "./_lib/actions";
import { parseForgotPasswordSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.auth.forgot_password.title") };
};

interface ForgotPasswordPageProps {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{
    email?: string;
    error?: string;
    requested?: string;
  }>;
}

const ForgotPasswordFallback = () => (
  <AuthScreenBody>
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-9 w-48" />
  </AuthScreenBody>
);

const ForgotPasswordPageContent = async ({
  searchParams,
}: ForgotPasswordPageProps) => {
  const tenantId = await getTenantId();

  const { defaultEmail, errorMessage, requested } =
    parseForgotPasswordSearchParams(await searchParams);

  return requested ? (
    <AuthScreenBody>
      <FormMessage variant="success">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.forgot_password.requested_sent" />
        </Suspense>
      </FormMessage>
      <AuthScreenNote>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.forgot_password.requested_help" />
        </Suspense>
      </AuthScreenNote>
      <div className="flex flex-wrap gap-3">
        <LinkButton render={<Link href="/login" />}>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.auth.forgot_password.to_login" />
          </Suspense>
        </LinkButton>
        <LinkButton render={<Link href="/forgot-password" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.auth.forgot_password.try_another_email" />
          </Suspense>
        </LinkButton>
      </div>
    </AuthScreenBody>
  ) : (
    <>
      <AuthScreenBody>
        <form action={requestPasswordResetAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel htmlFor="email" required>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.auth.fields.email_label" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="email"
                defaultValue={defaultEmail}
                id="email"
                name="email"
                placeholder="admin@example.com"
                required
                type="email"
              />
            </FieldContent>
          </Field>

          {errorMessage ? (
            <FormMessage variant="destructive">{errorMessage}</FormMessage>
          ) : null}

          <Button className="justify-self-start" type="submit">
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.auth.forgot_password.submit" />
            </Suspense>
          </Button>
        </form>
      </AuthScreenBody>

      <AuthScreenFooter>
        <p>
          <Link
            className="text-primary underline underline-offset-4"
            href="/login"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.auth.forgot_password.to_login" />
            </Suspense>
          </Link>
        </p>
      </AuthScreenFooter>
    </>
  );
};

const ForgotPasswordPage = ({
  params,
  searchParams,
}: ForgotPasswordPageProps) => (
  <AuthScreen>
    <AuthScreenHeader>
      <AuthScreenTitle>
        <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
          <Message message="admin.auth.forgot_password.title" />
        </Suspense>
      </AuthScreenTitle>
      <AuthScreenTagline>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.forgot_password.description" />
        </Suspense>
      </AuthScreenTagline>
    </AuthScreenHeader>

    <Suspense fallback={<ForgotPasswordFallback />}>
      <ForgotPasswordPageContent params={params} searchParams={searchParams} />
    </Suspense>
  </AuthScreen>
);

export default ForgotPasswordPage;
