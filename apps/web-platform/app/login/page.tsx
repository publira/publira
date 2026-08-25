import { Skeleton } from "@publira/ui-components";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import { Suspense } from "react";

import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { LoginForm } from "./_components/login-form";
import { parseLoginSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return { title: getMessage(messages, "platform.auth.login.title") };
};

const LoginEyebrow = async () => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return (
    <p className="mt-2 text-sm text-muted-foreground">
      {getMessage(messages, "platform.auth.login.eyebrow")}
    </p>
  );
};

const LoginFormWrapper = async ({
  searchParams,
}: {
  searchParams: PageProps<"/login">["searchParams"];
}) => {
  const { nextPath, passwordResetDone, sessionRevoked } =
    parseLoginSearchParams(await searchParams);
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return (
    <LoginForm
      copy={{
        emailLabel: getMessage(messages, "platform.auth.fields.email_label"),
        forgotPassword: getMessage(
          messages,
          "platform.auth.login.forgot_password"
        ),
        passwordLabel: getMessage(
          messages,
          "platform.auth.fields.password_label"
        ),
        pendingLabel: getMessage(messages, "platform.auth.login.pending"),
        resetDone: getMessage(messages, "platform.auth.login.reset_done"),
        sessionRevoked: getMessage(
          messages,
          "platform.auth.login.session_revoked"
        ),
        submitLabel: getMessage(messages, "platform.auth.login.submit"),
      }}
      nextPath={nextPath}
      resetDone={passwordResetDone}
      sessionRevoked={sessionRevoked}
    />
  );
};

const LoginFormSkeleton = () => (
  <div className="space-y-4">
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-full" />
  </div>
);

const LoginPage = ({ searchParams }: PageProps<"/login">) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <Suspense fallback={<Skeleton className="mx-auto mt-2 h-5 w-48" />}>
          <LoginEyebrow />
        </Suspense>
      </div>

      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <Suspense fallback={<LoginFormSkeleton />}>
          <LoginFormWrapper searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  </main>
);

export default LoginPage;
