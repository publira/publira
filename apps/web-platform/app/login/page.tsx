import { getMessage } from "@publira/i18n";
import {
  AuthScreen,
  AuthScreenHeader,
  AuthScreenTagline,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
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
  <AuthScreen>
    <AuthScreenHeader>
      <AuthScreenTitle>Publira</AuthScreenTitle>
      <AuthScreenTagline>
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="platform.auth.login.eyebrow" />
        </Suspense>
      </AuthScreenTagline>
    </AuthScreenHeader>

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
  </AuthScreen>
);

export default LoginPage;
