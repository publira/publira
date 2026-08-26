import { getMessage } from "@publira/i18n";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { LoginForm } from "./_components/login-form";
import { parseLoginSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.auth.login.title") };
};

type LoginSearchParams = PageProps<"/login">["searchParams"];

/**
 * The value the operator is sent back to after signing in. Hidden, so there is
 * nothing to stand in for it while the query resolves.
 */
const NextPathField = async ({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) => {
  const { nextPath } = parseLoginSearchParams(await searchParams);

  return <input name="next" type="hidden" value={nextPath} />;
};

const LoginFlash = async ({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) => {
  const { passwordResetDone, sessionRevoked } = parseLoginSearchParams(
    await searchParams
  );

  return (
    <>
      {sessionRevoked ? (
        <FormMessage variant="destructive">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.auth.login.session_revoked" />
          </Suspense>
        </FormMessage>
      ) : null}

      {passwordResetDone ? (
        <FormMessage variant="success">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.auth.login.reset_done" />
          </Suspense>
        </FormMessage>
      ) : null}
    </>
  );
};

const LoginPage = ({ searchParams }: PageProps<"/login">) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message message="platform.auth.login.eyebrow" />
          </Suspense>
        </p>
      </div>

      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <LoginForm
          flash={
            <Suspense fallback={null}>
              <LoginFlash searchParams={searchParams} />
            </Suspense>
          }
          nextField={
            <Suspense fallback={null}>
              <NextPathField searchParams={searchParams} />
            </Suspense>
          }
        />
      </div>
    </div>
  </main>
);

export default LoginPage;
