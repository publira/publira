import { getMessage } from "@publira/i18n";
import {
  AuthScreen,
  AuthScreenBody,
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

/** Why the link cannot be used, each reason carrying its own key. */
const FailureReason = ({ reason }: { reason: "expired" | "invalid" }) =>
  reason === "expired" ? (
    <Message message="platform.auth.confirm_password.expired" />
  ) : (
    <Message message="platform.auth.confirm_password.invalid" />
  );

const FailureState = ({ reason }: { reason: "expired" | "invalid" }) => (
  <AuthScreenBody>
    <FormMessage variant="destructive">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <FailureReason reason={reason} />
      </Suspense>
    </FormMessage>
    <AuthScreenNote>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="platform.auth.confirm_password.failure_help" />
      </Suspense>
    </AuthScreenNote>
    <div className="flex flex-wrap gap-3">
      <LinkButton render={<Link href="/reset-password" />}>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="platform.auth.confirm_password.request_again" />
        </Suspense>
      </LinkButton>
      <LinkButton render={<Link href="/login" />} variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="platform.auth.confirm_password.to_login" />
        </Suspense>
      </LinkButton>
    </div>
  </AuthScreenBody>
);

const ConfirmPasswordFallback = () => (
  <AuthScreenBody>
    <Skeleton className="h-5 w-full" />
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-9 w-40" />
  </AuthScreenBody>
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
    return <FailureState reason="expired" />;
  }
  if (status === "invalid" || token === "") {
    return <FailureState reason="invalid" />;
  }

  return (
    <AuthScreenBody>
      <AuthScreenNote>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.auth.confirm_password.description" />
        </Suspense>
      </AuthScreenNote>

      <form action={confirmPasswordAction} className="grid gap-4">
        <input name="token" type="hidden" value={token} />

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="platform.auth.confirm_password.password_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="new-password"
              name="password"
              placeholder="••••••••"
              required
              type="password"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
              <Message message="platform.auth.confirm_password.confirm_password_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="new-password"
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

        <Button className="justify-self-start" type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.auth.confirm_password.submit" />
          </Suspense>
        </Button>
      </form>
    </AuthScreenBody>
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
  <AuthScreen>
    <AuthScreenHeader>
      <AuthScreenTitle>Publira</AuthScreenTitle>
      <AuthScreenTagline>
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="platform.auth.confirm_password.title" />
        </Suspense>
      </AuthScreenTagline>
    </AuthScreenHeader>

    <Suspense fallback={<ConfirmPasswordFallback />}>
      <ConfirmPasswordPageContent searchParams={searchParams} />
    </Suspense>
  </AuthScreen>
);

export default ConfirmPasswordPage;
