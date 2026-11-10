import * as AuthScreen from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import { TenantIdField } from "#components/tenant-id-field";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { MFA_CHALLENGE_PATH, readMfaChallenge } from "#lib/mfa-challenge";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";
import { tenantLocalePath } from "#lib/tenant-locale-path";

import { SignInPanel } from "../../_components/sign-in-panel";
import { verifyMfaAction } from "./_lib/actions";
import { MFA_METHOD_PARAM, parseMfaMethod } from "./_lib/method";
import type { MfaMethod } from "./_lib/method";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.auth.two_step.title") };
};

/** `placeholder` is an attribute rather than a node, so it waits for the catalog alone. */
const CodeInput = async ({ method }: { method: MfaMethod }) => {
  const t = await getMessages();

  return (
    <Input
      autoComplete="one-time-code"
      // A recovery code carries letters and a separator, so the numeric
      // keypad is only right for the authenticator's six digits.
      inputMode={method === "authenticator" ? "numeric" : "text"}
      name="code"
      placeholder={
        method === "authenticator"
          ? t("storefront.auth.two_step.code_placeholder")
          : undefined
      }
      required
      spellCheck={false}
      type="text"
    />
  );
};

/**
 * The code field, and the way to the other kind of code. Which one the field
 * asks for is the query's, so the switch is a link rather than state, and a
 * refused code keeps the method it was typed in.
 */
const TwoStepForm = ({ method }: { method: MfaMethod }) => (
  <>
    <AuthScreen.Body>
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          {method === "authenticator" ? (
            <Message message="storefront.auth.two_step.description" />
          ) : (
            <Message message="storefront.auth.two_step.recovery_description" />
          )}
        </Suspense>
      </p>

      <ActionForm.Root
        action={verifyMfaAction}
        className="grid gap-4"
        showSuccess={false}
      >
        <LocaleField />
        <TenantIdField />
        <input name="method" type="hidden" value={method} />

        <ActionForm.Fieldset>
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                {method === "authenticator" ? (
                  <Message message="storefront.auth.two_step.code_label" />
                ) : (
                  <Message message="storefront.auth.two_step.recovery_code_label" />
                )}
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Suspense fallback={<Skeleton className="h-10 w-full" />}>
                <CodeInput method={method} />
              </Suspense>
            </Field.Content>
          </Field.Root>
        </ActionForm.Fieldset>

        <ActionForm.Submit className="justify-self-start">
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="storefront.auth.two_step.submit" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="storefront.auth.two_step.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </ActionForm.Root>
    </AuthScreen.Body>

    <AuthScreen.Footer>
      <p>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-40" />}>
          {method === "authenticator" ? (
            <LocaleLink
              className="text-primary underline underline-offset-4"
              href={`${MFA_CHALLENGE_PATH}?${MFA_METHOD_PARAM}=recovery`}
              replace
            >
              <Message message="storefront.auth.two_step.use_recovery_code" />
            </LocaleLink>
          ) : (
            <LocaleLink
              className="text-primary underline underline-offset-4"
              href={MFA_CHALLENGE_PATH}
              replace
            >
              <Message message="storefront.auth.two_step.use_authenticator" />
            </LocaleLink>
          )}
        </Suspense>
      </p>
      <p>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-32" />}>
          <LocaleLink
            className="text-primary underline underline-offset-4"
            href="/login"
          >
            <Message message="storefront.auth.fields.to_login" />
          </LocaleLink>
        </Suspense>
      </p>
    </AuthScreen.Footer>
  </>
);

const TwoStepFormSkeleton = () => (
  <>
    <AuthScreen.Body>
      <SkeletonLine className="h-4 w-full" />
      <div className="grid gap-2">
        <SkeletonLine className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
      <Skeleton className="h-9 w-24" />
    </AuthScreen.Body>
    <AuthScreen.Footer>
      <SkeletonLine className="h-4 w-40" />
      <SkeletonLine className="h-4 w-32" />
    </AuthScreen.Footer>
  </>
);

/**
 * The form, once the challenge the sign-in left is known to be there. Without
 * one there is nothing to finish: the reader opened the step on its own, or
 * let the challenge run out, and signs in again.
 */
const TwoStepContent = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/login/two-step">["searchParams"];
}) => {
  const [challenge, query, tenantId, locale] = await Promise.all([
    readMfaChallenge(),
    searchParams,
    getTenantId(),
    getLocale(),
  ]);

  if (!challenge || challenge.tenantId !== tenantId) {
    redirect(await tenantLocalePath(tenantId, locale, "/login"));
  }

  return <TwoStepForm method={parseMfaMethod(query[MFA_METHOD_PARAM])} />;
};

const TwoStepHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [siteLabel, t] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);

  return (
    <>
      <TenantDocumentTitle
        pageTitle={t("storefront.auth.two_step.title")}
        siteLabel={siteLabel}
      />
      <AuthScreen.Title>{t("storefront.auth.two_step.title")}</AuthScreen.Title>
    </>
  );
};

/** The code a sign-in asks for after the password or a provider's sign-in. */
const TwoStepPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/login/two-step">) => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <TwoStepHeader />
        </Suspense>
      </AuthScreen.Header>

      <Suspense fallback={<TwoStepFormSkeleton />}>
        <TwoStepContent searchParams={searchParams} />
      </Suspense>
    </AuthScreen.Main>

    <SignInPanel />
  </AuthScreen.Root>
);

export default TwoStepPage;
