import { AuthScreenBody, AuthScreenFooter } from "@publira/layouts/auth-screen";
import { Checkbox } from "@publira/ui-components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "#components/action-form";
import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantIdField } from "#components/tenant-id-field";
import { getMessages } from "#lib/get-messages";
import { getTenantAgeVerification, getTenantLegalPages } from "#lib/tenant";
import type { TenantLegalPage } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { signupAction } from "../_lib/actions";

/**
 * The one control in this form whose copy cannot be a node: `placeholder` is
 * an attribute, so this input resolves the accessor itself. Its label does not
 * — that is a `<Message>` at the call site — so the wait is the input alone.
 */
const NameInput = async () => {
  const t = await getMessages();

  return (
    <Input
      id="name"
      name="name"
      placeholder={t("host.auth.signup.name_placeholder")}
      type="text"
    />
  );
};

/**
 * Offered only where the tenant checks ages, and optional there: a reader who
 * leaves it empty still gets an account, and can give the date later on the
 * settings screen.
 *
 * The control carries no `max`. Capping it at today would read the clock while
 * this route prerenders, which Cache Components refuses
 * (`blocking-prerender-current-time`); a date in the future is refused by the
 * form instead.
 */
const BirthDateField = async () => {
  const tenantId = await getTenantId();
  const [ageVerification, t] = await Promise.all([
    getTenantAgeVerification(tenantId),
    getMessages(),
  ]);
  if (ageVerification === "none") {
    return null;
  }

  return (
    <Field>
      <FieldLabel htmlFor="birthDate">
        {t("host.auth.signup.birth_date_label")}
      </FieldLabel>
      <FieldContent>
        <Input
          autoComplete="bday"
          id="birthDate"
          name="birthDate"
          type="date"
        />
        <FieldDescription>
          {t("host.auth.signup.birth_date_help")}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

/** Opens in a new tab, so reading the text does not throw away the form. */
const LegalPageLink = ({ page }: { page: TenantLegalPage }) => (
  <LocaleLink
    href={page.href}
    className="text-primary underline underline-offset-4"
    rel="noopener"
    target="_blank"
  >
    {page.title}
  </LocaleLink>
);

/**
 * Asked only where the tenant names a terms or privacy page. Each version sent
 * is the one whose title this form links to, so what the API records is the
 * text the reader was shown.
 */
const ConsentField = async () => {
  const tenantId = await getTenantId();
  const { privacyPage, termsPage } = await getTenantLegalPages(tenantId);
  if (!termsPage && !privacyPage) {
    return null;
  }

  return (
    <Field>
      {termsPage ? (
        <input
          name="agreedPageVersionIds"
          type="hidden"
          value={termsPage.versionId}
        />
      ) : null}
      {privacyPage ? (
        <input
          name="agreedPageVersionIds"
          type="hidden"
          value={privacyPage.versionId}
        />
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox name="consent" required />
        <FieldLabel>
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message message="host.auth.signup.consent_label" />
          </Suspense>
        </FieldLabel>
      </div>
      <FieldDescription className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
        {termsPage ? <LegalPageLink page={termsPage} /> : null}
        {privacyPage ? <LegalPageLink page={privacyPage} /> : null}
      </FieldDescription>
    </Field>
  );
};

export const SignupForm = () => (
  <>
    <AuthScreenBody>
      <ActionForm action={signupAction} className="grid gap-4">
        <LocaleField />
        <TenantIdField />

        <Field>
          <FieldLabel htmlFor="name">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="host.auth.signup.name_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Suspense fallback={<Skeleton className="h-10 w-full" />}>
              <NameInput />
            </Suspense>
          </FieldContent>
        </Field>

        <Suspense fallback={null}>
          <BirthDateField />
        </Suspense>

        <Field>
          <FieldLabel htmlFor="email">
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="host.auth.fields.email_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              id="email"
              name="email"
              placeholder="your@email.com"
              type="email"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="password">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="host.auth.fields.password_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="new-password"
              id="password"
              name="password"
              placeholder="••••••••"
              type="password"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="confirmPassword">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="host.auth.signup.password_confirm_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="new-password"
              id="confirmPassword"
              name="confirmPassword"
              placeholder="••••••••"
              type="password"
            />
          </FieldContent>
        </Field>

        <Suspense fallback={null}>
          <ConsentField />
        </Suspense>

        <ActionFormSubmit className="justify-self-start">
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="host.auth.signup.submit" />
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="host.auth.signup.submitting" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </ActionForm>
    </AuthScreenBody>

    <AuthScreenFooter>
      <p className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="host.auth.signup.have_account" />
        </Suspense>{" "}
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-12" />}>
          <LocaleLink
            href="/login"
            className="text-primary underline underline-offset-4"
          >
            <Message message="host.auth.signup.login" />
          </LocaleLink>
        </Suspense>
      </p>
    </AuthScreenFooter>
  </>
);
