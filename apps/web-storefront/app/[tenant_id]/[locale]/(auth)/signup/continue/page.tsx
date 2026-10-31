import * as AuthScreen from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { TenantIdField } from "#components/tenant-id-field";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantSiteCopy, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { SignInPanel } from "../../_components/sign-in-panel";
import { BirthDateField, ConsentField } from "../_components/sign-up-fields";
import { continueSignUpAction } from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.auth.social.continue.title") };
};

const ContinueSignUpHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [{ siteTagline }, siteLabel, t] = await Promise.all([
    getTenantSiteCopy(tenantId, locale),
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);

  return (
    <>
      <TenantDocumentTitle
        pageTitle={t("storefront.auth.social.continue.title")}
        siteLabel={siteLabel}
      />
      <AuthScreen.Title>{siteLabel}</AuthScreen.Title>
      {siteTagline ? (
        <AuthScreen.Tagline>{siteTagline}</AuthScreen.Tagline>
      ) : null}
    </>
  );
};

/**
 * Where a first sign-in with Apple or Google asks for the consent the tenant
 * requires before the account is created.
 */
const ContinueSignUpPage = () => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <ContinueSignUpHeader />
        </Suspense>
      </AuthScreen.Header>

      <AuthScreen.Body>
        <AuthScreen.Note>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="storefront.auth.social.continue.description" />
          </Suspense>
        </AuthScreen.Note>

        <ActionForm.Root action={continueSignUpAction} className="grid gap-4">
          <LocaleField />
          <TenantIdField />

          <Suspense fallback={null}>
            <BirthDateField />
          </Suspense>

          <Suspense fallback={null}>
            <ConsentField />
          </Suspense>

          <ActionForm.Submit className="justify-self-start">
            <ActionForm.Idle>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="storefront.auth.social.continue.submit" />
              </Suspense>
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="storefront.auth.signup.submitting" />
              </Suspense>
            </ActionForm.Pending>
          </ActionForm.Submit>
        </ActionForm.Root>
      </AuthScreen.Body>

      <AuthScreen.Footer>
        <p>
          <Suspense
            fallback={<SkeletonLine className="inline-block h-4 w-24" />}
          >
            <LocaleLink
              href="/login"
              className="text-primary underline underline-offset-4"
            >
              <Message message="storefront.auth.fields.to_login" />
            </LocaleLink>
          </Suspense>
        </p>
      </AuthScreen.Footer>
    </AuthScreen.Main>

    <SignInPanel />
  </AuthScreen.Root>
);

export default ContinueSignUpPage;
