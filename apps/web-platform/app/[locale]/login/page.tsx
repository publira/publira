import * as AuthScreen from "@publira/layouts/auth-screen";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import { LoginForm } from "./_components/login-form";
import { parseLoginSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("platform.auth.login.title") };
};

/** The notices the query asks for: a revoked session, a finished reset. */
const LoginFlash = ({
  passwordResetDone,
  sessionRevoked,
}: {
  passwordResetDone: boolean;
  sessionRevoked: boolean;
}) => (
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

/**
 * The form, once the query has resolved.
 *
 * The path the operator is sent back to rides in a hidden field, and every
 * label around it is in the static shell. A form rendered beside a boundary of
 * that field's own could be submitted before the field streamed in, and would
 * send the operator to the dashboard instead, so the whole form waits for the
 * query.
 */
const LoginFormContent = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/login">["searchParams"];
}) => {
  const { nextPath, passwordResetDone, sessionRevoked } =
    parseLoginSearchParams(await searchParams);

  return (
    <LoginForm
      flash={
        <LoginFlash
          passwordResetDone={passwordResetDone}
          sessionRevoked={sessionRevoked}
        />
      }
      nextField={<input name="next" type="hidden" value={nextPath} />}
    />
  );
};

const LoginFormSkeleton = () => (
  <AuthScreen.Body>
    <div className="grid gap-2">
      <SkeletonLine className="h-4 w-28" />
      <Skeleton className="h-10 w-full" />
    </div>
    <div className="grid gap-2">
      <SkeletonLine className="h-4 w-20" />
      <Skeleton className="h-10 w-full" />
    </div>
    <Skeleton className="h-9 w-24" />
  </AuthScreen.Body>
);

const LoginPage = ({ searchParams }: PageProps<"/[locale]/login">) => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <AuthScreen.Title>Publira</AuthScreen.Title>
        <AuthScreen.Tagline>
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message message="platform.auth.login.eyebrow" />
          </Suspense>
        </AuthScreen.Tagline>
      </AuthScreen.Header>

      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginFormContent searchParams={searchParams} />
      </Suspense>

      <AuthScreen.Footer>
        <p>
          <Link
            className="text-primary underline underline-offset-4"
            href="/reset-password"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="platform.auth.login.forgot_password" />
            </Suspense>
          </Link>
        </p>
      </AuthScreen.Footer>
    </AuthScreen.Main>

    <AuthScreen.Panel>
      <AuthScreen.Pattern />
    </AuthScreen.Panel>
  </AuthScreen.Root>
);

export default LoginPage;
