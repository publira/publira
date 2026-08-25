import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { parseResetPasswordRequestedSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return {
    title: getMessage(messages, "platform.auth.reset_password_requested.title"),
  };
};

/**
 * The address the mail went to is the only part of this screen that depends on
 * the query, so it is the only part behind a boundary. It is absent as often as
 * it is present, which is why the fallback is nothing rather than a skeleton.
 */
const SentTo = async ({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) => {
  await connection();

  const { email } = parseResetPasswordRequestedSearchParams(await searchParams);
  if (!email) {
    return null;
  }

  return (
    <p className="text-muted-foreground">
      <Message
        message="platform.auth.reset_password_requested.sent_to"
        skeletonClassName="w-56"
        values={{ email }}
      />
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
          <Message
            message="platform.auth.reset_password_requested.title"
            skeletonClassName="w-44"
          />
        </p>
      </header>

      <section className="space-y-3 text-sm leading-6">
        <FormMessage variant="success">
          <Message
            message="platform.auth.reset_password_requested.sent"
            skeletonClassName="w-full"
          />
        </FormMessage>

        <Suspense fallback={null}>
          <SentTo searchParams={searchParams} />
        </Suspense>

        <p className="text-muted-foreground">
          <Message
            message="platform.auth.reset_password_requested.check_spam"
            skeletonClassName="w-full"
          />
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <LinkButton className="flex-1" render={<Link href="/login" />}>
          <Message
            message="platform.auth.reset_password_requested.to_login"
            skeletonClassName="w-32"
          />
        </LinkButton>
        <LinkButton
          className="flex-1"
          render={<Link href="/reset-password" />}
          variant="outline"
        >
          <Message
            message="platform.auth.reset_password_requested.try_another_email"
            skeletonClassName="w-40"
          />
        </LinkButton>
      </div>
    </div>
  </main>
);

export default ResetPasswordRequestedPage;
