import { Skeleton } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Message } from "#components/message";
import { confirmPlatformEmailChange } from "#lib/email-change";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { parseConfirmEmailSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return { title: getMessage(messages, "platform.auth.confirm_email.title") };
};

const ResultLink = ({ children, href }: { children: string; href: string }) => (
  <div className="text-center text-sm">
    <Link className="font-medium text-primary hover:underline" href={href}>
      {children}
    </Link>
  </div>
);

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

/**
 * Which sentence this screen shows is the RPC's answer, so nothing here can
 * render before that call returns. Per-string boundaries would only add
 * skeletons inside a section that is already a skeleton, so the copy is
 * resolved as strings.
 */
const ConfirmationResult = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  await connection();

  const { token } = parseConfirmEmailSearchParams(await searchParams);
  const messages = await loadPlatformMessages(await getPlatformLocale());

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

const ConfirmEmailPage = ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <header className="text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Message
            message="platform.auth.confirm_email.title"
            skeletonClassName="w-44"
          />
        </p>
      </header>

      <Suspense fallback={<ConfirmationSkeleton />}>
        <ConfirmationResult searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default ConfirmEmailPage;
