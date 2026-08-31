import { getMessage } from "@publira/i18n";
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
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <Skeleton className="h-11 w-full" />
    <Skeleton className="h-10 w-full" />
  </div>
);

const ForgotPasswordPageContent = async ({
  searchParams,
}: ForgotPasswordPageProps) => {
  const tenantId = await getTenantId();

  const { defaultEmail, errorMessage, requested } =
    parseForgotPasswordSearchParams(await searchParams);

  return requested ? (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <FormMessage variant="success">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.forgot_password.requested_sent" />
        </Suspense>
      </FormMessage>
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.forgot_password.requested_help" />
        </Suspense>
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <LinkButton className="flex-1" render={<Link href="/login" />}>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.auth.forgot_password.to_login" />
          </Suspense>
        </LinkButton>
        <LinkButton
          className="flex-1"
          render={<Link href="/forgot-password" />}
          variant="outline"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.auth.forgot_password.try_another_email" />
          </Suspense>
        </LinkButton>
      </div>
    </div>
  ) : (
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <form action={requestPasswordResetAction} className="space-y-4">
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

        <Button className="w-full" type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.auth.forgot_password.submit" />
          </Suspense>
        </Button>
      </form>

      <div className="text-center text-sm">
        <Link
          className="font-medium text-primary hover:underline"
          href="/login"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.auth.forgot_password.to_login" />
          </Suspense>
        </Link>
      </div>
    </div>
  );
};

const ForgotPasswordPage = ({
  params,
  searchParams,
}: ForgotPasswordPageProps) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-serif text-2xl font-semibold">
          <Suspense fallback={<SkeletonLine className="mx-auto h-7 w-40" />}>
            <Message message="admin.auth.forgot_password.title" />
          </Suspense>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="admin.auth.forgot_password.description" />
          </Suspense>
        </p>
      </div>

      <Suspense fallback={<ForgotPasswordFallback />}>
        <ForgotPasswordPageContent
          params={params}
          searchParams={searchParams}
        />
      </Suspense>
    </div>
  </main>
);

export default ForgotPasswordPage;
