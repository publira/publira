import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { PlatformMessageKey } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { confirmPasswordAction } from "./_lib/actions";
import { parseConfirmPasswordSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return {
    title: getMessage(messages, "platform.auth.confirm_password.title"),
  };
};

const FailureState = ({ reason }: { reason: PlatformMessageKey }) => (
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <FormMessage variant="destructive">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message={reason} />
      </Suspense>
    </FormMessage>
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="platform.auth.confirm_password.failure_help" />
      </Suspense>
    </p>
    <div className="flex flex-col gap-3 sm:flex-row">
      <LinkButton className="flex-1" render={<Link href="/reset-password" />}>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="platform.auth.confirm_password.request_again" />
        </Suspense>
      </LinkButton>
      <LinkButton
        className="flex-1"
        render={<Link href="/login" />}
        variant="outline"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="platform.auth.confirm_password.to_login" />
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

/** The query decides between the form and the two failure states. */
const ConfirmPasswordPageContent = async ({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    status?: string | string[];
    token?: string | string[];
  }>;
}) => {
  const { errorMessage, status, token } = parseConfirmPasswordSearchParams(
    await searchParams
  );

  if (status === "expired") {
    return <FailureState reason="platform.auth.confirm_password.expired" />;
  }
  if (status === "invalid" || token === "") {
    return <FailureState reason="platform.auth.confirm_password.invalid" />;
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.auth.confirm_password.description" />
        </Suspense>
      </p>

      <form action={confirmPasswordAction} className="space-y-4">
        <input name="token" type="hidden" value={token} />

        <Field>
          <FieldLabel htmlFor="password" required>
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="platform.auth.confirm_password.password_label" />
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
              <Message message="platform.auth.confirm_password.confirm_password_label" />
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
            <Message message="platform.auth.confirm_password.submit" />
          </Suspense>
        </Button>
      </form>
    </div>
  );
};

const ConfirmPasswordPage = ({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    status?: string | string[];
    token?: string | string[];
  }>;
}) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message message="platform.auth.confirm_password.title" />
          </Suspense>
        </p>
      </div>

      <Suspense fallback={<ConfirmPasswordFallback />}>
        <ConfirmPasswordPageContent searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default ConfirmPasswordPage;
