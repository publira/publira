import * as AuthScreen from "@publira/layouts/auth-screen";
import { Button, LinkButton } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

import { requestPasswordResetAction } from "./_lib/actions";
import { parseForgotPasswordSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.auth.forgot_password.title") };
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
  <AuthScreen.Body>
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-9 w-48" />
  </AuthScreen.Body>
);

const ForgotPasswordPageContent = async ({
  searchParams,
}: ForgotPasswordPageProps) => {
  const tenantId = await getTenantId();

  const { defaultEmail, errorMessage, requested } =
    parseForgotPasswordSearchParams(await searchParams);

  return requested ? (
    <AuthScreen.Body>
      <FormMessage variant="success">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.forgot_password.requested_sent" />
        </Suspense>
      </FormMessage>
      <AuthScreen.Note>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.forgot_password.requested_help" />
        </Suspense>
      </AuthScreen.Note>
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
    </AuthScreen.Body>
  ) : (
    <>
      <AuthScreen.Body>
        <form action={requestPasswordResetAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.auth.fields.email_label" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                autoComplete="email"
                defaultValue={defaultEmail}
                name="email"
                placeholder="admin@example.com"
                required
                type="email"
              />
            </Field.Content>
          </Field.Root>

          {errorMessage ? (
            <FormMessage variant="destructive">{errorMessage}</FormMessage>
          ) : null}

          <Button className="justify-self-start" type="submit">
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.auth.forgot_password.submit" />
            </Suspense>
          </Button>
        </form>
      </AuthScreen.Body>

      <AuthScreen.Footer>
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
      </AuthScreen.Footer>
    </>
  );
};

const ForgotPasswordPage = ({
  params,
  searchParams,
}: ForgotPasswordPageProps) => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <AuthScreen.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.auth.forgot_password.title" />
          </Suspense>
        </AuthScreen.Title>
        <AuthScreen.Tagline>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="admin.auth.forgot_password.description" />
          </Suspense>
        </AuthScreen.Tagline>
      </AuthScreen.Header>

      <Suspense fallback={<ForgotPasswordFallback />}>
        <ForgotPasswordPageContent
          params={params}
          searchParams={searchParams}
        />
      </Suspense>
    </AuthScreen.Main>

    <AuthScreen.Panel>
      <AuthScreen.Pattern />
    </AuthScreen.Panel>
  </AuthScreen.Root>
);

export default ForgotPasswordPage;
