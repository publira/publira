import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenHeader,
  AuthScreenMain,
  AuthScreenNote,
  AuthScreenTagline,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { LegalPagesConsentField } from "#components/legal-pages-consent-field";
import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SignOutForm } from "#components/sign-out-form";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { TenantIdField } from "#components/tenant-id-field";
import { returnToSearchParamSchema } from "#lib/auth-input";
import { withPublicSessionReauth } from "#lib/auth-session";
import { getMessages } from "#lib/get-messages";
import {
  ACCOUNT_DELETION_PATH,
  LEGAL_PAGE_AGREEMENT_PATH,
  legalPageAgreementHref,
} from "#lib/legal-page-agreement-path";
import { getOwedLegalPages } from "#lib/legal-page-agreements";
import { getLocale } from "#lib/locale";
import { logoutAction } from "#lib/logout-action";
import { getMessagesFor } from "#lib/messages";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";
import { tenantLocalePath } from "#lib/tenant-locale-path";

import { agreeToLegalPagesAction } from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.auth.agreement.title") };
};

const agreementSearchParamsSchema = z.object({
  returnTo: returnToSearchParamSchema,
});

const AgreementHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [info, siteLabel, t] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);
  const siteTagline = info?.siteTagline?.trim();

  return (
    <>
      <TenantDocumentTitle
        pageTitle={t("storefront.auth.agreement.title")}
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
 * Cache Components streams the static shell first. An operable fallback form
 * would submit `returnTo="/"` before `searchParams` resolve.
 */
const AgreementFormSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-4 w-56" />
    <SkeletonLine className="h-4 w-40" />
    <Skeleton className="h-9 w-32" />
  </div>
);

/**
 * The pages the reader owes, read when the screen is drawn, so the versions it
 * sends are the ones it links to. A reader who owes nothing — one who agreed
 * in another tab, or opened the screen by its address — goes straight back.
 */
const AgreementForm = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/settings/agreement">["searchParams"];
}) => {
  const [params, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { returnTo } = agreementSearchParamsSchema.parse(params);
  const pages = await withPublicSessionReauth(
    locale,
    legalPageAgreementHref(LEGAL_PAGE_AGREEMENT_PATH, returnTo),
    () => getOwedLegalPages(tenantId, locale),
    tenantId
  );
  if (pages.length === 0) {
    redirect(await tenantLocalePath(tenantId, locale, returnTo));
  }

  return (
    <ActionForm action={agreeToLegalPagesAction} className="grid gap-4">
      <LocaleField />
      <TenantIdField />
      <input name="returnTo" type="hidden" value={returnTo} />

      <LegalPagesConsentField pages={pages} />

      <ActionFormSubmit className="justify-self-start">
        <ActionFormIdle>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.auth.agreement.submit" />
          </Suspense>
        </ActionFormIdle>
        <ActionFormPending>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.auth.agreement.submitting" />
          </Suspense>
        </ActionFormPending>
      </ActionFormSubmit>
    </ActionForm>
  );
};

/**
 * What a reader who would rather not agree can still do: sign out, or delete
 * the account, which the public API leaves open to them.
 */
const AgreementSignOut = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  return (
    <SignOutForm
      locale={locale}
      signOut={logoutAction.bind(null, tenantId, locale)}
      tenantId={tenantId}
    >
      <button
        className="cursor-pointer text-primary underline underline-offset-4"
        type="submit"
      >
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-16" />}>
          <Message message="storefront.nav.logout" />
        </Suspense>
      </button>
    </SignOutForm>
  );
};

/**
 * Where a signed-in reader is sent when the tenant has published a version of
 * its terms of service or privacy policy that asks every reader to agree again,
 * and they have not. It asks the way **Finish signing up** does, then returns
 * them to the page they were on.
 */
const LegalPageAgreementPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/settings/agreement">) => (
  <AuthScreen>
    <AuthScreenMain>
      <AuthScreenHeader>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <AgreementHeader />
        </Suspense>
      </AuthScreenHeader>

      <AuthScreenBody>
        <AuthScreenNote>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="storefront.auth.agreement.description" />
          </Suspense>
        </AuthScreenNote>

        <Suspense fallback={<AgreementFormSkeleton />}>
          <AgreementForm searchParams={searchParams} />
        </Suspense>
      </AuthScreenBody>

      <AuthScreenFooter>
        <p className="text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="storefront.auth.agreement.decline" />
          </Suspense>
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Suspense
            fallback={<SkeletonLine className="inline-block h-4 w-16" />}
          >
            <AgreementSignOut />
          </Suspense>
          <Suspense
            fallback={<SkeletonLine className="inline-block h-4 w-28" />}
          >
            <LocaleLink
              href={ACCOUNT_DELETION_PATH}
              className="text-primary underline underline-offset-4"
            >
              <Message message="storefront.auth.agreement.delete_account" />
            </LocaleLink>
          </Suspense>
        </div>
      </AuthScreenFooter>
    </AuthScreenMain>
  </AuthScreen>
);

export default LegalPageAgreementPage;
