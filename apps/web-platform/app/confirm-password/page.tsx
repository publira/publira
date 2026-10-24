import * as AuthScreen from "@publira/layouts/auth-screen";
import { Button, LinkButton } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import * as PasswordInput from "@publira/ui-components/password-input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

import { confirmPasswordAction } from "./_lib/actions";
import { parseConfirmPasswordSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return {
    title: t("platform.auth.confirm_password.title"),
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
  <AuthScreen.Body>
    <FormMessage variant="destructive">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <FailureReason reason={reason} />
      </Suspense>
    </FormMessage>
    <AuthScreen.Note>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="platform.auth.confirm_password.failure_help" />
      </Suspense>
    </AuthScreen.Note>
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
  </AuthScreen.Body>
);

const ConfirmPasswordFallback = () => (
  <AuthScreen.Body>
    <Skeleton className="h-5 w-full" />
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-9 w-40" />
  </AuthScreen.Body>
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
    <AuthScreen.Body>
      <AuthScreen.Note>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.auth.confirm_password.description" />
        </Suspense>
      </AuthScreen.Note>

      <form action={confirmPasswordAction} className="grid gap-4">
        <input name="token" type="hidden" value={token} />

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="platform.auth.confirm_password.password_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <PasswordInput.Root>
              <PasswordInput.Control
                autoComplete="new-password"
                name="password"
                placeholder="••••••••"
                required
              />
              <PasswordInput.Toggle>
                <Suspense fallback={null}>
                  <Message message="platform.common.show_password" />
                </Suspense>
              </PasswordInput.Toggle>
            </PasswordInput.Root>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
              <Message message="platform.auth.confirm_password.confirm_password_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <PasswordInput.Root>
              <PasswordInput.Control
                autoComplete="new-password"
                name="confirm_password"
                placeholder="••••••••"
                required
              />
              <PasswordInput.Toggle>
                <Suspense fallback={null}>
                  <Message message="platform.common.show_password" />
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
            <Message message="platform.auth.confirm_password.submit" />
          </Suspense>
        </Button>
      </form>
    </AuthScreen.Body>
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
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <AuthScreen.Title>Publira</AuthScreen.Title>
        <AuthScreen.Tagline>
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message message="platform.auth.confirm_password.title" />
          </Suspense>
        </AuthScreen.Tagline>
      </AuthScreen.Header>

      <Suspense fallback={<ConfirmPasswordFallback />}>
        <ConfirmPasswordPageContent searchParams={searchParams} />
      </Suspense>
    </AuthScreen.Main>

    <AuthScreen.Panel>
      <AuthScreen.Pattern />
    </AuthScreen.Panel>
  </AuthScreen.Root>
);

export default ConfirmPasswordPage;
