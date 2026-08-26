import { getMessage } from "@publira/i18n";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { PlatformMessageKey } from "#components/message";
import { confirmPlatformEmailChange } from "#lib/email-change";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { parseConfirmEmailSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.auth.confirm_email.title") };
};

const ConfirmationBody = ({
  href,
  link,
  message,
}: {
  href: string;
  link: PlatformMessageKey;
  message: PlatformMessageKey;
}) => (
  <>
    <section className="space-y-3 text-sm leading-6">
      <p>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message={message} />
        </Suspense>
      </p>
    </section>
    <div className="text-center text-sm">
      <Link className="font-medium text-primary hover:underline" href={href}>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message={link} />
        </Suspense>
      </Link>
    </div>
  </>
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

/** Which sentence this screen shows is the RPC's answer. */
const ConfirmationResult = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  const { token } = parseConfirmEmailSearchParams(await searchParams);

  if (!token) {
    return (
      <ConfirmationBody
        href="/settings/account"
        link="platform.auth.confirm_email.back_to_settings"
        message="platform.auth.confirm_email.invalid_link"
      />
    );
  }

  const result = await confirmPlatformEmailChange(token);

  if (result?.changed) {
    return (
      <ConfirmationBody
        href="/"
        link="platform.auth.confirm_email.to_dashboard"
        message="platform.auth.confirm_email.changed"
      />
    );
  }

  let message: PlatformMessageKey = "platform.auth.confirm_email.failed";
  if (result?.confirmed) {
    message =
      result.pendingConfirmationFor === "current_email"
        ? "platform.auth.confirm_email.pending_current_email"
        : "platform.auth.confirm_email.pending_new_email";
  }

  return (
    <ConfirmationBody
      href="/settings/account"
      link="platform.auth.confirm_email.back_to_settings"
      message={message}
    />
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
          <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
            <Message message="platform.auth.confirm_email.title" />
          </Suspense>
        </p>
      </header>

      <Suspense fallback={<ConfirmationSkeleton />}>
        <ConfirmationResult searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default ConfirmEmailPage;
