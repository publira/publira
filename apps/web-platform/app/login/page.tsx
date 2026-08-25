import { FormMessage } from "@publira/ui-components/form-message";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { LoginForm } from "./_components/login-form";
import { parseLoginSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

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
          <Message
            message="platform.auth.login.session_revoked"
            skeletonClassName="w-full"
          />
        </FormMessage>
      ) : null}

      {passwordResetDone ? (
        <FormMessage variant="success">
          <Message
            message="platform.auth.login.reset_done"
            skeletonClassName="w-full"
          />
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
          <Message
            message="platform.auth.login.eyebrow"
            skeletonClassName="w-48"
          />
        </p>
      </div>

      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <LoginForm
          copy={{
            emailLabel: (
              <Message
                message="platform.auth.fields.email_label"
                skeletonClassName="w-28"
              />
            ),
            forgotPassword: (
              <Message
                message="platform.auth.login.forgot_password"
                skeletonClassName="w-36"
              />
            ),
            passwordLabel: (
              <Message
                message="platform.auth.fields.password_label"
                skeletonClassName="w-20"
              />
            ),
            pendingLabel: (
              <Message
                message="platform.auth.login.pending"
                skeletonClassName="w-20"
              />
            ),
            submitLabel: (
              <Message
                message="platform.auth.login.submit"
                skeletonClassName="w-16"
              />
            ),
          }}
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
