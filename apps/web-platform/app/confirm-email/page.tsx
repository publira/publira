import { Skeleton } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { confirmPlatformEmailChange } from "#lib/email-change";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";

import { parseConfirmEmailSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return { title: getMessage(messages, "platform.auth.confirm_email.title") };
};

const ConfirmEmailEyebrow = async () => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return (
    <p className="mt-2 text-sm text-muted-foreground">
      {getMessage(messages, "platform.auth.confirm_email.title")}
    </p>
  );
};

const ResultLink = ({ children, href }: { children: string; href: string }) => (
  <div className="text-center text-sm">
    <Link className="font-medium text-primary hover:underline" href={href}>
      {children}
    </Link>
  </div>
);

const ConfirmationResult = async ({
  messages,
  token,
}: {
  messages: PlatformMessages;
  token: string;
}) => {
  if (!token) {
    return (
      <>
        <section className="space-y-3 text-sm leading-6">
          <p>
            {getMessage(messages, "platform.auth.confirm_email.invalid_link")}
          </p>
        </section>
        <ResultLink href="/settings/account">
          {getMessage(messages, "platform.auth.confirm_email.back_to_settings")}
        </ResultLink>
      </>
    );
  }

  const result = await confirmPlatformEmailChange(token);
  let message = getMessage(messages, "platform.auth.confirm_email.failed");

  if (result) {
    if (result.changed) {
      message = getMessage(messages, "platform.auth.confirm_email.changed");
    } else if (result.confirmed) {
      message =
        result.pendingConfirmationFor === "current_email"
          ? getMessage(
              messages,
              "platform.auth.confirm_email.pending_current_email"
            )
          : getMessage(
              messages,
              "platform.auth.confirm_email.pending_new_email"
            );
    }
  }

  return (
    <>
      <section className="space-y-3 text-sm leading-6">
        <p>{message}</p>
      </section>
      <ResultLink href={result?.changed ? "/" : "/settings/account"}>
        {result?.changed
          ? getMessage(messages, "platform.auth.confirm_email.to_dashboard")
          : getMessage(
              messages,
              "platform.auth.confirm_email.back_to_settings"
            )}
      </ResultLink>
    </>
  );
};

const ConfirmationSkeleton = () => (
  <>
    <section className="space-y-3">
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-2/3" />
    </section>
    <div className="text-center">
      <Skeleton className="mx-auto h-5 w-28" />
    </div>
  </>
);

const ConfirmEmailPageContent = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  await connection();

  const { token } = parseConfirmEmailSearchParams(await searchParams);
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return <ConfirmationResult messages={messages} token={token} />;
};

const ConfirmEmailPage = ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <header className="text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <Suspense fallback={<Skeleton className="mx-auto mt-2 h-5 w-44" />}>
          <ConfirmEmailEyebrow />
        </Suspense>
      </header>

      <Suspense fallback={<ConfirmationSkeleton />}>
        <ConfirmEmailPageContent searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default ConfirmEmailPage;
