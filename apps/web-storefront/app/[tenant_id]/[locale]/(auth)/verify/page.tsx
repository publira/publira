import * as AuthScreen from "@publira/layouts/auth-screen";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { verifyPublicEmail } from "#lib/auth";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantSiteCopy, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { SignInPanel } from "../_components/sign-in-panel";
import { parseVerifySearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.auth.verify.title") };
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
    <AuthScreen.Body>
      <AuthScreen.Text>{children}</AuthScreen.Text>
    </AuthScreen.Body>
    <AuthScreen.Footer>
      <p>{link}</p>
    </AuthScreen.Footer>
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
              <Message message="storefront.auth.verify.to_resend_verification" />
            </LocaleLink>
          </Suspense>
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.auth.fields.invalid_token" />
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
              <Message message="storefront.auth.verify.to_login" />
            </LocaleLink>
          </Suspense>
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.auth.verify.verified" />
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
            <Message message="storefront.auth.verify.to_resend_verification" />
          </LocaleLink>
        </Suspense>
      }
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="storefront.auth.verify.failed" />
      </Suspense>
    </VerificationOutcome>
  );
};

const VerificationFallback = () => (
  <>
    <AuthScreen.Body>
      <SkeletonLine className="h-4 w-full" />
      <SkeletonLine className="h-4 w-3/4" />
    </AuthScreen.Body>
    <AuthScreen.Footer>
      <SkeletonLine className="h-4 w-28" />
    </AuthScreen.Footer>
  </>
);

/** The tenant's own name and tagline, which only the site read can supply. */
const VerifyHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [{ siteTagline }, siteLabel, t] = await Promise.all([
    getTenantSiteCopy(tenantId, locale),
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);

  return (
    <>
      <TenantDocumentTitle
        pageTitle={t("storefront.auth.verify.title")}
        siteLabel={siteLabel}
      />
      <AuthScreen.Title>{siteLabel}</AuthScreen.Title>
      {siteTagline ? (
        <AuthScreen.Tagline>{siteTagline}</AuthScreen.Tagline>
      ) : null}
    </>
  );
};

const VerificationContent = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  const { token } = parseVerifySearchParams(await searchParams);

  return <VerificationResult token={token} />;
};

const VerifyPage = ({
  searchParams,
}: {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <VerifyHeader />
        </Suspense>
      </AuthScreen.Header>

      <Suspense fallback={<VerificationFallback />}>
        <VerificationContent searchParams={searchParams} />
      </Suspense>
    </AuthScreen.Main>

    <SignInPanel />
  </AuthScreen.Root>
);

export default VerifyPage;
