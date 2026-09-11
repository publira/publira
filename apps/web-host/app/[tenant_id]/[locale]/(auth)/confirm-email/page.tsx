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
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { confirmPublicEmailChange } from "#lib/auth";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { parseConfirmEmailSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.auth.confirm_email.title") };
};

const CONFIRM_EMAIL_LINK_CLASS_NAME = cn(
  "text-primary underline underline-offset-4"
);

/**
 * What the confirmation link turned out to be. The branch is a decision about
 * what happened; the copy for each outcome is written, key and all, in the two
 * components below.
 */
type ConfirmEmailOutcome =
  | "changed"
  | "failed"
  | "invalid_link"
  | "pending_current_email"
  | "pending_new_email";

const confirmEmailOutcome = (
  result: Awaited<ReturnType<typeof confirmPublicEmailChange>>
): ConfirmEmailOutcome => {
  if (result?.changed) {
    return "changed";
  }
  if (result?.confirmed) {
    return result.pendingConfirmationFor === "current_email"
      ? "pending_current_email"
      : "pending_new_email";
  }
  return "failed";
};

const ConfirmEmailSentence = ({
  outcome,
}: {
  outcome: ConfirmEmailOutcome;
}) => {
  switch (outcome) {
    case "changed": {
      return <Message message="host.auth.confirm_email.changed" />;
    }
    case "invalid_link": {
      return <Message message="host.auth.fields.invalid_token" />;
    }
    case "pending_current_email": {
      return (
        <Message message="host.auth.confirm_email.pending_current_email" />
      );
    }
    case "pending_new_email": {
      return <Message message="host.auth.confirm_email.pending_new_email" />;
    }
    default: {
      return <Message message="host.auth.confirm_email.failed" />;
    }
  }
};

/**
 * Where the outcome leaves the reader: the address really changed, so their
 * own page is the useful next screen; anything else sends them back to the
 * settings screen the change was started from.
 */
const ConfirmEmailLink = ({ outcome }: { outcome: ConfirmEmailOutcome }) =>
  outcome === "changed" ? (
    <LocaleLink className={CONFIRM_EMAIL_LINK_CLASS_NAME} href="/my">
      <Message message="host.auth.confirm_email.to_my" />
    </LocaleLink>
  ) : (
    <LocaleLink className={CONFIRM_EMAIL_LINK_CLASS_NAME} href="/settings">
      <Message message="host.auth.confirm_email.to_settings" />
    </LocaleLink>
  );

const ConfirmationOutcome = ({ outcome }: { outcome: ConfirmEmailOutcome }) => (
  <>
    <AuthScreenBody>
      <AuthScreenText>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <ConfirmEmailSentence outcome={outcome} />
        </Suspense>
      </AuthScreenText>
    </AuthScreenBody>
    <AuthScreenFooter>
      <p>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-40" />}>
          <ConfirmEmailLink outcome={outcome} />
        </Suspense>
      </p>
    </AuthScreenFooter>
  </>
);

const ConfirmationResult = async ({ token }: { token: string }) => {
  if (!token) {
    return <ConfirmationOutcome outcome="invalid_link" />;
  }

  const tenantId = await getTenantId();
  const result = await confirmPublicEmailChange(token, tenantId);

  return <ConfirmationOutcome outcome={confirmEmailOutcome(result)} />;
};

const ConfirmationFallback = () => (
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
const ConfirmEmailHeader = async () => {
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
        pageTitle={getMessage(messages, "host.auth.confirm_email.title")}
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
const ConfirmationContent = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  await connection();

  const { token } = parseConfirmEmailSearchParams(await searchParams);

  return <ConfirmationResult token={token} />;
};

const ConfirmEmailPage = ({
  searchParams,
}: {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) => (
  <AuthScreen>
    <AuthScreenHeader>
      <Suspense fallback={<Skeleton className="h-8 w-40" />}>
        <ConfirmEmailHeader />
      </Suspense>
    </AuthScreenHeader>

    <Suspense fallback={<ConfirmationFallback />}>
      <ConfirmationContent searchParams={searchParams} />
    </Suspense>
  </AuthScreen>
);

export default ConfirmEmailPage;
