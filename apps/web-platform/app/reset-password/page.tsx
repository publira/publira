import { SkeletonLine } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { ResetPasswordForm } from "./_components/reset-password-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return { title: getMessage(messages, "platform.auth.reset_password.title") };
};

const ResetPasswordPage = () => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.auth.reset_password.description" />
          </Suspense>
        </p>
      </div>

      <ResetPasswordForm
        copy={{
          emailLabel: (
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="platform.auth.fields.email_label" />
            </Suspense>
          ),
          pendingLabel: (
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="platform.auth.reset_password.pending" />
            </Suspense>
          ),
          submitLabel: (
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.auth.reset_password.submit" />
            </Suspense>
          ),
          toLogin: (
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.auth.reset_password.to_login" />
            </Suspense>
          ),
        }}
      />
    </div>
  </main>
);

export default ResetPasswordPage;
