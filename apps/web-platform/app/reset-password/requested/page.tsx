import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { parseResetPasswordRequestedSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return {
    title: getMessage(messages, "platform.auth.reset_password_requested.title"),
  };
};

const RequestedEyebrow = async () => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return (
    <p className="mt-2 text-sm text-muted-foreground">
      {getMessage(messages, "platform.auth.reset_password_requested.title")}
    </p>
  );
};

const RequestedContent = async ({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) => {
  await connection();

  const { email } = parseResetPasswordRequestedSearchParams(await searchParams);
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return (
    <>
      <section className="space-y-3 text-sm leading-6">
        <FormMessage variant="success">
          {getMessage(messages, "platform.auth.reset_password_requested.sent")}
        </FormMessage>
        {email ? (
          <p className="text-muted-foreground">
            {getMessage(
              messages,
              "platform.auth.reset_password_requested.sent_to",
              { email }
            )}
          </p>
        ) : null}
        <p className="text-muted-foreground">
          {getMessage(
            messages,
            "platform.auth.reset_password_requested.check_spam"
          )}
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <LinkButton className="flex-1" render={<Link href="/login" />}>
          {getMessage(
            messages,
            "platform.auth.reset_password_requested.to_login"
          )}
        </LinkButton>
        <LinkButton
          className="flex-1"
          render={<Link href="/reset-password" />}
          variant="outline"
        >
          {getMessage(
            messages,
            "platform.auth.reset_password_requested.try_another_email"
          )}
        </LinkButton>
      </div>
    </>
  );
};

const RequestedSkeleton = () => (
  <>
    <section className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-5 w-full" />
    </section>
    <div className="flex flex-col gap-3 sm:flex-row">
      <Skeleton className="h-10 flex-1" />
      <Skeleton className="h-10 flex-1" />
    </div>
  </>
);

const ResetPasswordRequestedPage = ({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <header className="text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <Suspense fallback={<Skeleton className="mx-auto mt-2 h-5 w-44" />}>
          <RequestedEyebrow />
        </Suspense>
      </header>

      <Suspense fallback={<RequestedSkeleton />}>
        <RequestedContent searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default ResetPasswordRequestedPage;
