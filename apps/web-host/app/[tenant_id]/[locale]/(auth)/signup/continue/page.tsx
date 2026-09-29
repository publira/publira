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
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { TenantIdField } from "#components/tenant-id-field";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { BirthDateField, ConsentField } from "../_components/sign-up-fields";
import { continueSignUpAction } from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("host.auth.social.continue.title") };
};

const ContinueSignUpHeader = async () => {
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
        pageTitle={t("host.auth.social.continue.title")}
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
 * Where a first sign-in with Apple or Google asks for the consent the tenant
 * requires before the account is created.
 */
const ContinueSignUpPage = () => (
  <AuthScreen>
    <AuthScreenMain>
      <AuthScreenHeader>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <ContinueSignUpHeader />
        </Suspense>
      </AuthScreenHeader>

      <AuthScreenBody>
        <AuthScreenNote>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="host.auth.social.continue.description" />
          </Suspense>
        </AuthScreenNote>

        <ActionForm action={continueSignUpAction} className="grid gap-4">
          <LocaleField />
          <TenantIdField />

          <Suspense fallback={null}>
            <BirthDateField />
          </Suspense>

          <Suspense fallback={null}>
            <ConsentField />
          </Suspense>

          <ActionFormSubmit className="justify-self-start">
            <ActionFormIdle>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="host.auth.social.continue.submit" />
              </Suspense>
            </ActionFormIdle>
            <ActionFormPending>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="host.auth.signup.submitting" />
              </Suspense>
            </ActionFormPending>
          </ActionFormSubmit>
        </ActionForm>
      </AuthScreenBody>

      <AuthScreenFooter>
        <p>
          <Suspense
            fallback={<SkeletonLine className="inline-block h-4 w-24" />}
          >
            <LocaleLink
              href="/login"
              className="text-primary underline underline-offset-4"
            >
              <Message message="host.auth.fields.to_login" />
            </LocaleLink>
          </Suspense>
        </p>
      </AuthScreenFooter>
    </AuthScreenMain>
  </AuthScreen>
);

export default ContinueSignUpPage;
