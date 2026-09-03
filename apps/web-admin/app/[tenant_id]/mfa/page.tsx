import { getMessage } from "@publira/i18n";
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
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <SkeletonLine className="h-4 w-full" />
    <Skeleton className="h-11 w-full" />
    <Skeleton className="h-10 w-full" />
  </div>
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
 * session this screen exists to issue — the forms below are Client Components
 * and still have to speak the tenant's language.
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
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.auth.mfa.title" />
          </Suspense>
        </p>
      </div>

      <Suspense fallback={<MfaPageFallback />}>
        <MfaPageContent />
      </Suspense>
    </div>
  </main>
);

export default MfaPage;
