import { Skeleton } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import { Suspense } from "react";

import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { ResetPasswordForm } from "./_components/reset-password-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return { title: getMessage(messages, "platform.auth.reset_password.title") };
};

const ResetPasswordEyebrow = async () => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return (
    <p className="mt-2 text-sm text-muted-foreground">
      {getMessage(messages, "platform.auth.reset_password.description")}
    </p>
  );
};

const ResetPasswordSection = async () => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return (
    <ResetPasswordForm
      copy={{
        emailLabel: getMessage(messages, "platform.auth.fields.email_label"),
        pendingLabel: getMessage(
          messages,
          "platform.auth.reset_password.pending"
        ),
        submitLabel: getMessage(
          messages,
          "platform.auth.reset_password.submit"
        ),
        toLogin: getMessage(messages, "platform.auth.reset_password.to_login"),
      }}
    />
  );
};

const ResetPasswordSkeleton = () => (
  <>
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-5 w-full" />
    </div>
    <div className="mt-4 text-center">
      <Skeleton className="mx-auto h-5 w-32" />
    </div>
  </>
);

const ResetPasswordPage = () => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <Suspense fallback={<Skeleton className="mx-auto mt-2 h-5 w-64" />}>
          <ResetPasswordEyebrow />
        </Suspense>
      </div>

      <Suspense fallback={<ResetPasswordSkeleton />}>
        <ResetPasswordSection />
      </Suspense>
    </div>
  </main>
);

export default ResetPasswordPage;
