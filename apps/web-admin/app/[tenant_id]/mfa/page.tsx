import * as AuthScreen from "@publira/layouts/auth-screen";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AdminLocaleProvider } from "#components/admin-locale-provider";
import { Message } from "#components/message";
import { buildLoginPath } from "#lib/admin-auth-shared";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { readStoredMfaChallenge } from "#lib/mfa-challenge";
import { getTenantId } from "#lib/tenant-id";

import { MfaEnrollFlow } from "./_components/mfa-enroll-flow";
import { MfaVerifyForm } from "./_components/mfa-verify-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.auth.mfa.title") };
};

const MfaPageFallback = () => (
  <AuthScreen.Body>
    <SkeletonLine className="h-4 w-full" />
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-9 w-32" />
  </AuthScreen.Body>
);

/**
 * The second half of a login.
 *
 * The challenge lives in a sealed cookie rather than the URL, so this screen
 * has nothing to read from the request but that cookie: no challenge means the
 * password step has not happened, or has run out, and the operator starts over
 * at `/login`. A finished challenge renders the same flow, which is what keeps
 * the answer to the submission that finished it on screen.
 */
const MfaPageContent = async () => {
  const [tenantId, challenge] = await Promise.all([
    getTenantId(),
    readStoredMfaChallenge(),
  ]);

  if (!challenge || challenge.tenantId !== tenantId) {
    redirect(buildLoginPath(challenge?.nextPath));
  }

  const finished = "finished" in challenge;

  return challenge.kind === "enroll" ? (
    <MfaEnrollFlow
      finished={finished}
      nextPath={challenge.nextPath}
      tenantId={tenantId}
    />
  ) : (
    <MfaVerifyForm
      finished={finished}
      methods={challenge.methods}
      nextPath={challenge.nextPath}
      tenantId={tenantId}
    />
  );
};

const MfaPage = () => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <AuthScreen.Title>Publira</AuthScreen.Title>
        <AuthScreen.Tagline>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.auth.mfa.title" />
          </Suspense>
        </AuthScreen.Tagline>
      </AuthScreen.Header>

      {/* The passkey forms word what the browser refused on the client. */}
      <AdminLocaleProvider>
        <Suspense fallback={<MfaPageFallback />}>
          <MfaPageContent />
        </Suspense>
      </AdminLocaleProvider>
    </AuthScreen.Main>

    <AuthScreen.Panel>
      <AuthScreen.Pattern />
    </AuthScreen.Panel>
  </AuthScreen.Root>
);

export default MfaPage;
