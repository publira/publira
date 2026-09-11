import { getMessage } from "@publira/i18n";
import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenHeader,
  AuthScreenNote,
  AuthScreenTagline,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { confirmAdminEmailChange } from "#lib/admin-auth";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { parseConfirmEmailSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.auth.confirm_email.title") };
};

interface ConfirmEmailPageProps {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{
    token?: string;
  }>;
}

/**
 * What the confirmation link turned out to be. The branch is a decision about
 * what happened; the sentences for each outcome are written, key and all, in
 * the two components below.
 */
type ConfirmEmailOutcome =
  | "changed"
  | "failed"
  | "invalid_link"
  | "pending_current_email"
  | "pending_new_email";

/** Whether the link did what it was sent to do, which decides the tone. */
const isGoodOutcome = (outcome: ConfirmEmailOutcome): boolean =>
  outcome === "changed" ||
  outcome === "pending_current_email" ||
  outcome === "pending_new_email";

/** What happened, in the tone the outcome deserves. */
const ConfirmEmailHeadline = ({
  outcome,
}: {
  outcome: ConfirmEmailOutcome;
}) => {
  switch (outcome) {
    case "changed": {
      return <Message message="admin.auth.confirm_email.changed" />;
    }
    case "invalid_link": {
      return <Message message="admin.auth.confirm_email.invalid_link" />;
    }
    case "pending_current_email":
    case "pending_new_email": {
      return <Message message="admin.auth.confirm_email.pending" />;
    }
    default: {
      return <Message message="admin.auth.confirm_email.failed" />;
    }
  }
};

/** What the operator does next, which the two pending outcomes differ on. */
const ConfirmEmailHelp = ({ outcome }: { outcome: ConfirmEmailOutcome }) => {
  switch (outcome) {
    case "changed": {
      return <Message message="admin.auth.confirm_email.changed_help" />;
    }
    case "pending_current_email": {
      return (
        <Message message="admin.auth.confirm_email.pending_current_email" />
      );
    }
    case "pending_new_email": {
      return <Message message="admin.auth.confirm_email.pending_new_email" />;
    }
    default: {
      return <Message message="admin.auth.confirm_email.failure_help" />;
    }
  }
};

const ConfirmationBody = ({ outcome }: { outcome: ConfirmEmailOutcome }) => (
  <AuthScreenBody>
    <FormMessage variant={isGoodOutcome(outcome) ? "success" : "destructive"}>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <ConfirmEmailHeadline outcome={outcome} />
      </Suspense>
    </FormMessage>
    <AuthScreenNote>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <ConfirmEmailHelp outcome={outcome} />
      </Suspense>
    </AuthScreenNote>
    <LinkButton className="justify-self-start" render={<Link href="/login" />}>
      <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
        <Message message="admin.auth.confirm_email.to_login" />
      </Suspense>
    </LinkButton>
  </AuthScreenBody>
);

const ConfirmationResult = async ({ token }: { token: string }) => {
  if (!token) {
    return <ConfirmationBody outcome="invalid_link" />;
  }

  const tenantId = await getTenantId();
  const result = await confirmAdminEmailChange(tenantId, token);

  if (result?.changed) {
    return <ConfirmationBody outcome="changed" />;
  }

  if (result?.confirmed) {
    return (
      <ConfirmationBody
        outcome={
          result.pendingConfirmationFor === "current_email"
            ? "pending_current_email"
            : "pending_new_email"
        }
      />
    );
  }

  return <ConfirmationBody outcome="failed" />;
};

const ConfirmEmailFallback = () => (
  <AuthScreenBody>
    <Skeleton className="h-5 w-full" />
    <Skeleton className="h-5 w-full" />
    <Skeleton className="h-9 w-32" />
  </AuthScreenBody>
);

const ConfirmEmailPageContent = async ({
  searchParams,
}: ConfirmEmailPageProps) => {
  const { token } = parseConfirmEmailSearchParams(await searchParams);

  return <ConfirmationResult token={token} />;
};

const ConfirmEmailPage = ({ params, searchParams }: ConfirmEmailPageProps) => (
  <AuthScreen>
    <AuthScreenHeader>
      <AuthScreenTitle>
        <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
          <Message message="admin.auth.confirm_email.title" />
        </Suspense>
      </AuthScreenTitle>
      <AuthScreenTagline>
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="admin.auth.confirm_email.processing" />
        </Suspense>
      </AuthScreenTagline>
    </AuthScreenHeader>

    <Suspense fallback={<ConfirmEmailFallback />}>
      <ConfirmEmailPageContent params={params} searchParams={searchParams} />
    </Suspense>
  </AuthScreen>
);

export default ConfirmEmailPage;
