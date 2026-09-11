import { getMessage } from "@publira/i18n";
import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenHeader,
  AuthScreenTagline,
  AuthScreenText,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { verifyPublicEmail } from "#lib/auth";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { parseVerifySearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.auth.verify.title") };
};

/**
 * The shape every outcome takes: what the link did, and the one screen it
 * leaves the reader at. The sentence and the link are nodes rather than
 * catalog keys, so each branch below writes its own key where it is rendered.
 */
const VerificationOutcome = ({
  children,
  link,
}: {
  children: ReactNode;
  link: ReactNode;
}) => (
  <>
    <AuthScreenBody>
      <AuthScreenText>{children}</AuthScreenText>
    </AuthScreenBody>
    <AuthScreenFooter>
      <p>{link}</p>
    </AuthScreenFooter>
  </>
);

const VERIFICATION_LINK_CLASS_NAME = cn(
  "text-primary underline underline-offset-4"
);

/**
 * What a confirmation link did, and where it leaves the reader.
 *
 * A link that did not work sends them to `/resend-verification` rather than
 * back to sign-up: the account behind an expired link already exists, so
 * signing up again creates nothing, and it cannot be signed into or reset
 * until the address is confirmed.
 */
const VerificationResult = async ({ token }: { token: string }) => {
  if (!token) {
    return (
      <VerificationOutcome
        link={
          <Suspense
            fallback={<SkeletonLine className="inline-block h-4 w-40" />}
          >
            <LocaleLink
              className={VERIFICATION_LINK_CLASS_NAME}
              href="/resend-verification"
            >
              <Message message="host.auth.verify.to_resend_verification" />
            </LocaleLink>
          </Suspense>
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.auth.fields.invalid_token" />
        </Suspense>
      </VerificationOutcome>
    );
  }

  const tenantId = await getTenantId();
  const verified = await verifyPublicEmail(token, tenantId);

  if (verified) {
    return (
      <VerificationOutcome
        link={
          <Suspense
            fallback={<SkeletonLine className="inline-block h-4 w-28" />}
          >
            <LocaleLink className={VERIFICATION_LINK_CLASS_NAME} href="/login">
              <Message message="host.auth.verify.to_login" />
            </LocaleLink>
          </Suspense>
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.auth.verify.verified" />
        </Suspense>
      </VerificationOutcome>
    );
  }

  return (
    <VerificationOutcome
      link={
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-40" />}>
          <LocaleLink
            className={VERIFICATION_LINK_CLASS_NAME}
            href="/resend-verification"
          >
            <Message message="host.auth.verify.to_resend_verification" />
          </LocaleLink>
        </Suspense>
      }
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="host.auth.verify.failed" />
      </Suspense>
    </VerificationOutcome>
  );
};

const VerificationFallback = () => (
  <>
    <AuthScreenBody>
      <SkeletonLine className="h-4 w-full" />
      <SkeletonLine className="h-4 w-3/4" />
    </AuthScreenBody>
    <AuthScreenFooter>
      <SkeletonLine className="h-4 w-28" />
    </AuthScreenFooter>
  </>
);

/** The tenant's own name and tagline, which only the site read can supply. */
const VerifyHeader = async () => {
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
        pageTitle={getMessage(messages, "host.auth.verify.title")}
        siteLabel={siteLabel}
      />
      <AuthScreenTitle>{siteLabel}</AuthScreenTitle>
      {siteTagline ? (
        <AuthScreenTagline>{siteTagline}</AuthScreenTagline>
      ) : null}
    </>
  );
};

/**
 * `connection()` keeps the confirmation itself out of a prerender: it spends
 * the token, so it has to run once per reader rather than once per build.
 */
const VerificationContent = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  await connection();

  const { token } = parseVerifySearchParams(await searchParams);

  return <VerificationResult token={token} />;
};

const VerifyPage = ({
  searchParams,
}: {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) => (
  <AuthScreen>
    <AuthScreenHeader>
      <Suspense fallback={<Skeleton className="h-8 w-40" />}>
        <VerifyHeader />
      </Suspense>
    </AuthScreenHeader>

    <Suspense fallback={<VerificationFallback />}>
      <VerificationContent searchParams={searchParams} />
    </Suspense>
  </AuthScreen>
);

export default VerifyPage;
