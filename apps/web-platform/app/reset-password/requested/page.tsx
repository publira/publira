import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
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
    <p className="text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
        <Message
          message="platform.auth.reset_password_requested.sent_to"
          values={{ email }}
        />
      </Suspense>
    </p>
  );
};

const ResetPasswordRequestedPage = ({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <header className="text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
            <Message message="platform.auth.reset_password_requested.title" />
          </Suspense>
        </p>
      </header>

      <section className="space-y-3 text-sm leading-6">
        <FormMessage variant="success">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.auth.reset_password_requested.sent" />
          </Suspense>
        </FormMessage>

        <Suspense fallback={null}>
          <SentTo searchParams={searchParams} />
        </Suspense>

        <p className="text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.auth.reset_password_requested.check_spam" />
          </Suspense>
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <LinkButton className="flex-1" render={<Link href="/login" />}>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.auth.reset_password_requested.to_login" />
          </Suspense>
        </LinkButton>
        <LinkButton
          className="flex-1"
          render={<Link href="/reset-password" />}
          variant="outline"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.auth.reset_password_requested.try_another_email" />
          </Suspense>
        </LinkButton>
      </div>
    </div>
  </main>
);

export default ResetPasswordRequestedPage;
