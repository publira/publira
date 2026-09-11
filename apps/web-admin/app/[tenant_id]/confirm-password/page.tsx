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
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { confirmPasswordAction } from "./_lib/actions";
import { parseConfirmPasswordSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
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

/** Why the link cannot be used, each reason carrying its own key. */
const FailureReason = ({ status }: { status: "expired" | "invalid" }) =>
  status === "expired" ? (
    <Message message="admin.auth.confirm_password.expired" />
  ) : (
    <Message message="admin.auth.confirm_password.invalid" />
  );

const FailureState = ({ status }: { status: "expired" | "invalid" }) => (
  <AuthScreenBody>
    <FormMessage variant="destructive">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <FailureReason status={status} />
      </Suspense>
    </FormMessage>
    <AuthScreenNote>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="admin.auth.confirm_password.failure_help" />
      </Suspense>
    </AuthScreenNote>
    <div className="flex flex-wrap gap-3">
      <LinkButton render={<Link href="/forgot-password" />}>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="admin.auth.confirm_password.request_again" />
        </Suspense>
      </LinkButton>
      <LinkButton render={<Link href="/login" />} variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="admin.auth.confirm_password.to_login" />
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
    <AuthScreenBody>
      <AuthScreenNote>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.confirm_password.description" />
        </Suspense>
      </AuthScreenNote>

      <form action={confirmPasswordAction} className="grid gap-4">
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

        <Button className="justify-self-start" type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.auth.confirm_password.submit" />
          </Suspense>
        </Button>
      </form>
    </AuthScreenBody>
  );
};

const ConfirmPasswordPage = ({
  params,
  searchParams,
}: ConfirmPasswordPageProps) => (
  <AuthScreen>
    <AuthScreenHeader>
      <AuthScreenTitle>
        <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
          <Message message="admin.auth.confirm_password.title" />
        </Suspense>
      </AuthScreenTitle>
      <AuthScreenTagline>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.confirm_password.eyebrow" />
        </Suspense>
      </AuthScreenTagline>
    </AuthScreenHeader>

    <Suspense fallback={<ConfirmPasswordFallback />}>
      <ConfirmPasswordPageContent params={params} searchParams={searchParams} />
    </Suspense>
  </AuthScreen>
);

export default ConfirmPasswordPage;
