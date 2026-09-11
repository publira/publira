import { getMessage } from "@publira/i18n";
import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenHeader,
  AuthScreenTagline,
  AuthScreenText,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { confirmPlatformEmailChange } from "#lib/email-change";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { parseConfirmEmailSearchParams } from "./_lib/search-params";

const CONFIRM_EMAIL_LINK_CLASS_NAME = cn(
  "text-primary underline underline-offset-4"
);

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.auth.confirm_email.title") };
};

/**
 * What the confirmation link turned out to be. The branch is a decision about
 * what happened; the sentence and the link for each outcome are written, key
 * and all, in the two components below.
 */
type ConfirmEmailOutcome =
  | "changed"
  | "failed"
  | "invalid_link"
  | "pending_current_email"
  | "pending_new_email";

const ConfirmEmailSentence = ({
  outcome,
}: {
  outcome: ConfirmEmailOutcome;
}) => {
  switch (outcome) {
    case "changed": {
      return <Message message="platform.auth.confirm_email.changed" />;
    }
    case "invalid_link": {
      return <Message message="platform.auth.confirm_email.invalid_link" />;
    }
    case "pending_current_email": {
      return (
        <Message message="platform.auth.confirm_email.pending_current_email" />
      );
    }
    case "pending_new_email": {
      return (
        <Message message="platform.auth.confirm_email.pending_new_email" />
      );
    }
    default: {
      return <Message message="platform.auth.confirm_email.failed" />;
    }
  }
};

/**
 * Where the outcome leaves the operator: a completed change has nothing left
 * to do on the settings screen, so the dashboard is the useful next one.
 */
const ConfirmEmailLink = ({ outcome }: { outcome: ConfirmEmailOutcome }) =>
  outcome === "changed" ? (
    <Link className={CONFIRM_EMAIL_LINK_CLASS_NAME} href="/">
      <Message message="platform.auth.confirm_email.to_dashboard" />
    </Link>
  ) : (
    <Link className={CONFIRM_EMAIL_LINK_CLASS_NAME} href="/settings/account">
      <Message message="platform.auth.confirm_email.back_to_settings" />
    </Link>
  );

const ConfirmationBody = ({ outcome }: { outcome: ConfirmEmailOutcome }) => (
  <>
    <AuthScreenBody>
      <AuthScreenText>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <ConfirmEmailSentence outcome={outcome} />
        </Suspense>
      </AuthScreenText>
    </AuthScreenBody>
    <AuthScreenFooter>
      <p>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-28" />}>
          <ConfirmEmailLink outcome={outcome} />
        </Suspense>
      </p>
    </AuthScreenFooter>
  </>
);

const ConfirmationSkeleton = () => (
  <>
    <AuthScreenBody>
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-2/3" />
    </AuthScreenBody>
    <AuthScreenFooter>
      <Skeleton className="h-5 w-28" />
    </AuthScreenFooter>
  </>
);

/** Which sentence this screen shows is the RPC's answer. */
const ConfirmationResult = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  const { token } = parseConfirmEmailSearchParams(await searchParams);

  if (!token) {
    return <ConfirmationBody outcome="invalid_link" />;
  }

  const result = await confirmPlatformEmailChange(token);

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

const ConfirmEmailPage = ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => (
  <AuthScreen>
    <AuthScreenHeader>
      <AuthScreenTitle>Publira</AuthScreenTitle>
      <AuthScreenTagline>
        <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
          <Message message="platform.auth.confirm_email.title" />
        </Suspense>
      </AuthScreenTagline>
    </AuthScreenHeader>

    <Suspense fallback={<ConfirmationSkeleton />}>
      <ConfirmationResult searchParams={searchParams} />
    </Suspense>
  </AuthScreen>
);

export default ConfirmEmailPage;
