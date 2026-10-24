import * as AuthScreen from "@publira/layouts/auth-screen";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Message } from "#components/message";
import { buildLoginPath } from "#lib/auth-shared";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { readStoredMfaChallenge } from "#lib/mfa-challenge";

import { MfaEnrollFlow } from "./_components/mfa-enroll-flow";
import { MfaVerifyForm } from "./_components/mfa-verify-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.auth.mfa.title") };
};

const MfaPageFallback = () => (
  <AuthScreen.Body>
    <SkeletonLine className="h-4 w-full" />
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-9 w-32" />
  </AuthScreen.Body>
);

/**
 * The second half of a sign-in.
 *
 * The challenge lives in a sealed cookie rather than the URL, so this screen
 * has nothing to read from the request but that cookie: no challenge means the
 * password step has not happened, or has run out, and the operator starts over
 * at `/login`. A finished challenge renders the same flow, which is what keeps
 * the answer to the submission that finished it on screen.
 */
const MfaPageContent = async () => {
  const challenge = await readStoredMfaChallenge();
  if (!challenge) {
    redirect(buildLoginPath("/"));
  }

  const finished = "finished" in challenge;

  return challenge.kind === "enroll" ? (
    <MfaEnrollFlow finished={finished} nextPath={challenge.nextPath} />
  ) : (
    <MfaVerifyForm finished={finished} nextPath={challenge.nextPath} />
  );
};

const MfaPage = () => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <AuthScreen.Title>Publira</AuthScreen.Title>
        <AuthScreen.Tagline>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.auth.mfa.title" />
          </Suspense>
        </AuthScreen.Tagline>
      </AuthScreen.Header>

      <Suspense fallback={<MfaPageFallback />}>
        <MfaPageContent />
      </Suspense>
    </AuthScreen.Main>

    <AuthScreen.Panel>
      <AuthScreen.Pattern />
    </AuthScreen.Panel>
  </AuthScreen.Root>
);

export default MfaPage;
