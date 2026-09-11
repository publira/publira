import { getMessage } from "@publira/i18n";
import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenHeader,
  AuthScreenTagline,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AdminLocaleProvider } from "#components/admin-locale-context";
import { Message } from "#components/message";
import { buildLoginPath } from "#lib/admin-auth-shared";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { readMfaChallenge } from "#lib/mfa-challenge";
import { getTenantId } from "#lib/tenant-id";

import { MfaEnrollFlow } from "./_components/mfa-enroll-flow";
import { MfaVerifyForm } from "./_components/mfa-verify-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.auth.mfa.title") };
};

const MfaPageFallback = () => (
  <AuthScreenBody>
    <SkeletonLine className="h-4 w-full" />
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-9 w-32" />
  </AuthScreenBody>
);

/**
 * The second half of a login.
 *
 * The challenge lives in a sealed cookie rather than the URL, so this screen
 * has nothing to read from the request but that cookie: no challenge means the
 * password step has not happened, or has run out, and the operator starts over
 * at `/login`.
 *
 * The locale provider is here because the console's own layout is behind the
 * session this screen exists to issue, and the shared MFA controls the forms
 * render — the code field, the enrollment secret, the recovery codes — still
 * resolve their copy through it. The two forms themselves do not: their strings
 * are `<ClientMessage>`, one `<Suspense>` boundary each.
 */
const MfaPageContent = async () => {
  const [tenantId, challenge] = await Promise.all([
    getTenantId(),
    readMfaChallenge(),
  ]);
  if (!challenge || challenge.tenantId !== tenantId) {
    redirect(buildLoginPath(challenge?.nextPath));
  }

  const locale = await getLocale(tenantId);

  return (
    <AdminLocaleProvider locale={locale}>
      {challenge.kind === "enroll" ? (
        <MfaEnrollFlow nextPath={challenge.nextPath} tenantId={tenantId} />
      ) : (
        <MfaVerifyForm nextPath={challenge.nextPath} tenantId={tenantId} />
      )}
    </AdminLocaleProvider>
  );
};

const MfaPage = () => (
  <AuthScreen>
    <AuthScreenHeader>
      <AuthScreenTitle>Publira</AuthScreenTitle>
      <AuthScreenTagline>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="admin.auth.mfa.title" />
        </Suspense>
      </AuthScreenTagline>
    </AuthScreenHeader>

    <Suspense fallback={<MfaPageFallback />}>
      <MfaPageContent />
    </Suspense>
  </AuthScreen>
);

export default MfaPage;
