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
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { parseResetPasswordRequestedSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return {
    title: getMessage(messages, "platform.auth.reset_password_requested.title"),
  };
};

/**
 * The address the mail went to is the only part of this screen that depends on
 * the query, so it is the only part behind a boundary of its own. It is absent
 * as often as it is present, which is why its fallback is nothing rather than a
 * skeleton.
 */
const SentTo = async ({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) => {
  const { email } = parseResetPasswordRequestedSearchParams(await searchParams);
  if (!email) {
    return null;
  }

  return (
    <AuthScreenNote>
      <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
        <Message
          message="platform.auth.reset_password_requested.sent_to"
          values={{ email }}
        />
      </Suspense>
    </AuthScreenNote>
  );
};

const ResetPasswordRequestedPage = ({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) => (
  <AuthScreen>
    <AuthScreenHeader>
      <AuthScreenTitle>Publira</AuthScreenTitle>
      <AuthScreenTagline>
        <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
          <Message message="platform.auth.reset_password_requested.title" />
        </Suspense>
      </AuthScreenTagline>
    </AuthScreenHeader>

    <AuthScreenBody>
      <FormMessage variant="success">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.auth.reset_password_requested.sent" />
        </Suspense>
      </FormMessage>

      <Suspense fallback={null}>
        <SentTo searchParams={searchParams} />
      </Suspense>

      <AuthScreenNote>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.auth.reset_password_requested.check_spam" />
        </Suspense>
      </AuthScreenNote>

      <div className="flex flex-wrap gap-3">
        <LinkButton render={<Link href="/login" />}>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.auth.reset_password_requested.to_login" />
          </Suspense>
        </LinkButton>
        <LinkButton render={<Link href="/reset-password" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.auth.reset_password_requested.try_another_email" />
          </Suspense>
        </LinkButton>
      </div>
    </AuthScreenBody>
  </AuthScreen>
);

export default ResetPasswordRequestedPage;
