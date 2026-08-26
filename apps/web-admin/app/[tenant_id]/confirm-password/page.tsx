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

import { confirmPasswordAction } from "./_lib/actions";
import { parseConfirmPasswordSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);

  return {
    title: getMessage(messages, "admin.auth.confirm_password.title"),
  };
};

interface ConfirmPasswordPageProps {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{
    error?: string;
    status?: string;
    token?: string;
  }>;
}

const FailureState = ({ status }: { status: "expired" | "invalid" }) => (
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <FormMessage variant="destructive">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message
          message={
            status === "expired"
              ? "admin.auth.confirm_password.expired"
              : "admin.auth.confirm_password.invalid"
          }
        />
      </Suspense>
    </FormMessage>
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="admin.auth.confirm_password.failure_help" />
      </Suspense>
    </p>
    <div className="flex flex-col gap-3 sm:flex-row">
      <LinkButton className="flex-1" render={<Link href="/forgot-password" />}>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="admin.auth.confirm_password.request_again" />
        </Suspense>
      </LinkButton>
      <LinkButton
        className="flex-1"
        render={<Link href="/login" />}
        variant="outline"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="admin.auth.confirm_password.to_login" />
        </Suspense>
      </LinkButton>
    </div>
  </div>
);

const ConfirmPasswordFallback = () => (
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <Skeleton className="h-5 w-full" />
    <Skeleton className="h-11 w-full" />
    <Skeleton className="h-11 w-full" />
    <Skeleton className="h-10 w-full" />
  </div>
);

const ConfirmPasswordPageContent = async ({
  searchParams,
}: ConfirmPasswordPageProps) => {
  const tenantId = await getTenantId();

  const { errorMessage, status, token } = parseConfirmPasswordSearchParams(
    await searchParams
  );

  let failureStatus: "expired" | "invalid" | null = null;
  if (status === "expired" || status === "invalid") {
    failureStatus = status;
  } else if (token === "") {
    failureStatus = "invalid";
  }

  return failureStatus ? (
    <FailureState status={failureStatus} />
  ) : (
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.confirm_password.description" />
        </Suspense>
      </p>

      <form action={confirmPasswordAction} className="space-y-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="token" type="hidden" value={token} />

        <Field>
          <FieldLabel htmlFor="password" required>
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="admin.auth.confirm_password.password_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="new-password"
              id="password"
              name="password"
              placeholder="••••••••"
              required
              type="password"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="confirm_password" required>
            <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
              <Message message="admin.auth.confirm_password.confirm_password_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="new-password"
              id="confirm_password"
              name="confirm_password"
              placeholder="••••••••"
              required
              type="password"
            />
          </FieldContent>
        </Field>

        {errorMessage ? (
          <FormMessage variant="destructive">{errorMessage}</FormMessage>
        ) : null}

        <Button className="w-full" type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.auth.confirm_password.submit" />
          </Suspense>
        </Button>
      </form>
    </div>
  );
};

const ConfirmPasswordPage = ({
  params,
  searchParams,
}: ConfirmPasswordPageProps) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-serif text-2xl font-semibold">
          <Suspense fallback={<SkeletonLine className="mx-auto h-7 w-48" />}>
            <Message message="admin.auth.confirm_password.title" />
          </Suspense>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="admin.auth.confirm_password.eyebrow" />
          </Suspense>
        </p>
      </div>

      <Suspense fallback={<ConfirmPasswordFallback />}>
        <ConfirmPasswordPageContent
          params={params}
          searchParams={searchParams}
        />
      </Suspense>
    </div>
  </main>
);

export default ConfirmPasswordPage;
