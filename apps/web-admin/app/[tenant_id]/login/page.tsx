import * as AuthScreen from "@publira/layouts/auth-screen";
import { Button } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import * as PasswordInput from "@publira/ui-components/password-input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

import { loginAction } from "./_lib/actions";
import { parseLoginSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.auth.login.title") };
};

interface LoginPageProps {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{
    email?: string;
    error?: string;
    invited?: string;
    next?: string;
    reason?: string;
    reset?: string;
  }>;
}

const LoginPageFallback = () => (
  <>
    <AuthScreen.Body>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-9 w-32" />
    </AuthScreen.Body>
    <AuthScreen.Footer>
      <SkeletonLine className="h-4 w-36" />
    </AuthScreen.Footer>
  </>
);

const LoginPageContent = async ({
  searchParams,
}: Pick<LoginPageProps, "searchParams">) => {
  const tenantId = await getTenantId();

  const {
    defaultEmail,
    errorMessage,
    invitedDone,
    nextPath,
    passwordResetDone,
    sessionRevoked,
  } = parseLoginSearchParams(await searchParams);

  const forgotPasswordHref = defaultEmail
    ? `/forgot-password?${new URLSearchParams({ email: defaultEmail }).toString()}`
    : "/forgot-password";

  return (
    <>
      <AuthScreen.Body>
        <form action={loginAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="next" type="hidden" value={nextPath} />

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

          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.auth.fields.password_label" />
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
                    <Message message="admin.common.show_password" />
                  </Suspense>
                </PasswordInput.Toggle>
              </PasswordInput.Root>
            </Field.Content>
          </Field.Root>

          {invitedDone ? (
            <FormMessage variant="success">
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.auth.login.invited_done" />
              </Suspense>
            </FormMessage>
          ) : null}

          {passwordResetDone ? (
            <FormMessage variant="success">
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.auth.login.reset_done" />
              </Suspense>
            </FormMessage>
          ) : null}

          {sessionRevoked ? (
            <FormMessage variant="destructive">
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.auth.login.session_revoked" />
              </Suspense>
            </FormMessage>
          ) : null}

          {errorMessage ? (
            <FormMessage variant="destructive">{errorMessage}</FormMessage>
          ) : null}

          <Button className="justify-self-start" type="submit">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.auth.login.submit" />
            </Suspense>
          </Button>
        </form>
      </AuthScreen.Body>

      <AuthScreen.Footer>
        <p>
          <Link
            className="text-primary underline underline-offset-4"
            href={forgotPasswordHref}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="admin.auth.login.forgot_password" />
            </Suspense>
          </Link>
        </p>
      </AuthScreen.Footer>
    </>
  );
};

const LoginPage = (props: LoginPageProps) => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <AuthScreen.Title>Publira</AuthScreen.Title>
        <AuthScreen.Tagline>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.auth.login.eyebrow" />
          </Suspense>
        </AuthScreen.Tagline>
      </AuthScreen.Header>

      <Suspense fallback={<LoginPageFallback />}>
        <LoginPageContent {...props} />
      </Suspense>
    </AuthScreen.Main>

    <AuthScreen.Panel>
      <AuthScreen.Pattern />
    </AuthScreen.Panel>
  </AuthScreen.Root>
);

export default LoginPage;
