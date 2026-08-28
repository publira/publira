import { getMessage } from "@publira/i18n";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { confirmPublicEmailChange } from "#lib/auth";
import { getLocale, loadHostMessages } from "#lib/locale";
import type { HostMessageKey } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { parseConfirmEmailSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.auth.confirm_email.title") };
};

/**
 * The outcome picks a key rather than a sentence, so the branch stays a
 * decision about what happened and the copy still comes from the catalog.
 */
const confirmationMessageKey = (
  result: Awaited<ReturnType<typeof confirmPublicEmailChange>>
): HostMessageKey => {
  if (result?.changed) {
    return "host.auth.confirm_email.changed";
  }
  if (result?.confirmed) {
    return result.pendingConfirmationFor === "current_email"
      ? "host.auth.confirm_email.pending_current_email"
      : "host.auth.confirm_email.pending_new_email";
  }
  return "host.auth.confirm_email.failed";
};

const ConfirmationResult = async ({ token }: { token: string }) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const messages = await loadHostMessages(locale);

  if (!token) {
    return (
      <>
        <section className="space-y-3 text-sm leading-6">
          <p>{getMessage(messages, "host.auth.fields.invalid_token")}</p>
        </section>
        <div className="text-center text-sm">
          <LocaleLink
            href="/settings"
            className="font-medium text-primary hover:underline"
          >
            {getMessage(messages, "host.auth.confirm_email.to_settings")}
          </LocaleLink>
        </div>
      </>
    );
  }

  const result = await confirmPublicEmailChange(token, tenantId);

  return (
    <>
      <section className="space-y-3 text-sm leading-6">
        <p>{getMessage(messages, confirmationMessageKey(result))}</p>
      </section>
      <div className="text-center text-sm">
        <LocaleLink
          href={result?.changed ? "/my" : "/settings"}
          className="font-medium text-primary hover:underline"
        >
          {getMessage(
            messages,
            result?.changed
              ? "host.auth.confirm_email.to_my"
              : "host.auth.confirm_email.to_settings"
          )}
        </LocaleLink>
      </div>
    </>
  );
};

const ConfirmationFallback = () => (
  <>
    <header className="flex justify-center">
      <Skeleton className="h-8 w-40" />
    </header>
    <section className="space-y-3">
      <SkeletonLine className="h-4 w-full" />
      <SkeletonLine className="h-4 w-3/4" />
    </section>
    <div className="flex justify-center">
      <SkeletonLine className="h-4 w-28" />
    </div>
  </>
);

const ConfirmEmailPageContent = async ({
  searchParams,
}: {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) => {
  await connection();

  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [info, siteLabel, messages] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);
  const siteTagline = info?.siteTagline?.trim();

  const { token } = parseConfirmEmailSearchParams(await searchParams);

  return (
    <>
      <header className="text-center">
        <TenantDocumentTitle
          pageTitle={getMessage(messages, "host.auth.confirm_email.title")}
          siteLabel={siteLabel}
        />
        <h1 className="font-serif text-2xl font-semibold">{siteLabel}</h1>
        {siteTagline ? (
          <p className="mt-2 text-sm text-muted-foreground">{siteTagline}</p>
        ) : null}
      </header>

      <ConfirmationResult token={token} />
    </>
  );
};

const ConfirmEmailPage = ({
  params,
  searchParams,
}: {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <Suspense fallback={<ConfirmationFallback />}>
        <ConfirmEmailPageContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default ConfirmEmailPage;
