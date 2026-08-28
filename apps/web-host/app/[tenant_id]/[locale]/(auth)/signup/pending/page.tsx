import { getMessage } from "@publira/i18n";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import {
  readEmailFlashCookie,
  SIGNUP_PENDING_EMAIL_COOKIE,
} from "#lib/email-flash-cookie";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.auth.signup_pending.title") };
};

const SignupPendingHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [info, siteLabel, messages] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);
  const siteTagline = info?.siteTagline?.trim();

  return (
    <>
      <TenantDocumentTitle
        pageTitle={getMessage(messages, "host.auth.signup_pending.title")}
        siteLabel={siteLabel}
      />
      <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
      {siteTagline ? (
        <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
      ) : null}
    </>
  );
};

/** The address is only known once the flash cookie is read, so it blocks. */
const SignupPendingRecipient = async () => {
  const locale = await getLocale();
  const [email, messages] = await Promise.all([
    readEmailFlashCookie(SIGNUP_PENDING_EMAIL_COOKIE),
    loadHostMessages(locale),
  ]);

  if (!email) {
    return null;
  }

  return (
    <p className="text-muted-foreground">
      {getMessage(messages, "host.auth.fields.sent_to", { email })}
    </p>
  );
};

const SignupPendingPage = () => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <header className="text-center">
        <Suspense
          fallback={
            <div className="flex justify-center">
              <Skeleton className="h-8 w-40" />
            </div>
          }
        >
          <SignupPendingHeader />
        </Suspense>
      </header>

      <section className="space-y-3 text-sm leading-6">
        <p>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="host.auth.signup_pending.sent" />
          </Suspense>
        </p>
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <SignupPendingRecipient />
        </Suspense>
        <p className="text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="host.auth.fields.check_spam" />
          </Suspense>
        </p>
      </section>

      <div className="text-center text-sm">
        <LocaleLink
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="host.auth.fields.to_login" />
          </Suspense>
        </LocaleLink>
      </div>
    </div>
  </main>
);

export default SignupPendingPage;
