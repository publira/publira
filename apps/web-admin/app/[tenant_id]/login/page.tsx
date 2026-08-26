import { getMessage } from "@publira/i18n";
import { Button } from "@publira/ui-components/button";
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

import { loginAction } from "./_lib/actions";
import { parseLoginSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.auth.login.title") };
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
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <Skeleton className="h-11 w-full" />
    <Skeleton className="h-11 w-full" />
    <Skeleton className="h-10 w-full" />
  </div>
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
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <form action={loginAction} className="space-y-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="next" type="hidden" value={nextPath} />

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

        <Field>
          <FieldLabel htmlFor="password" required>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.auth.fields.password_label" />
            </Suspense>
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

        <div className="text-right text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href={forgotPasswordHref}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="admin.auth.login.forgot_password" />
            </Suspense>
          </Link>
        </div>

        <Button className="mt-2 w-full" type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.auth.login.submit" />
          </Suspense>
        </Button>
      </form>
    </div>
  );
};

const LoginPage = (props: LoginPageProps) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.auth.login.eyebrow" />
          </Suspense>
        </p>
      </div>

      <Suspense fallback={<LoginPageFallback />}>
        <LoginPageContent {...props} />
      </Suspense>
    </div>
  </main>
);

export default LoginPage;
