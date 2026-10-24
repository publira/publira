import * as AuthScreen from "@publira/layouts/auth-screen";
import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

import { parseResetPasswordRequestedSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return {
    title: t("platform.auth.reset_password_requested.title"),
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
    <AuthScreen.Note>
      <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
        <Message
          message="platform.auth.reset_password_requested.sent_to"
          values={{ email }}
        />
      </Suspense>
    </AuthScreen.Note>
  );
};

const ResetPasswordRequestedPage = ({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <AuthScreen.Title>Publira</AuthScreen.Title>
        <AuthScreen.Tagline>
          <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
            <Message message="platform.auth.reset_password_requested.title" />
          </Suspense>
        </AuthScreen.Tagline>
      </AuthScreen.Header>

      <AuthScreen.Body>
        <FormMessage variant="success">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.auth.reset_password_requested.sent" />
          </Suspense>
        </FormMessage>

        <Suspense fallback={null}>
          <SentTo searchParams={searchParams} />
        </Suspense>

        <AuthScreen.Note>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.auth.reset_password_requested.check_spam" />
          </Suspense>
        </AuthScreen.Note>

        <div className="flex flex-wrap gap-3">
          <LinkButton render={<Link href="/login" />}>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.auth.reset_password_requested.to_login" />
            </Suspense>
          </LinkButton>
          <LinkButton
            render={<Link href="/reset-password" />}
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.auth.reset_password_requested.try_another_email" />
            </Suspense>
          </LinkButton>
        </div>
      </AuthScreen.Body>
    </AuthScreen.Main>

    <AuthScreen.Panel>
      <AuthScreen.Pattern />
    </AuthScreen.Panel>
  </AuthScreen.Root>
);

export default ResetPasswordRequestedPage;
