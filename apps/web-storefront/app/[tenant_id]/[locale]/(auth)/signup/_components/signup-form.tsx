import * as AuthScreen from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import * as PasswordInput from "@publira/ui-components/password-input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SocialSignInButtons } from "#components/social-sign-in-buttons";
import { TenantIdField } from "#components/tenant-id-field";
import { getMessages } from "#lib/get-messages";

import { signupAction } from "../_lib/actions";
import { BirthDateField, ConsentField } from "./sign-up-fields";

/**
 * The one control in this form whose copy cannot be a node: `placeholder` is
 * an attribute, so this input resolves the accessor itself. Its label does not
 * — that is a `<Message>` at the call site — so the wait is the input alone.
 */
const NameInput = async () => {
  const t = await getMessages();

  return (
    <Input
      name="name"
      placeholder={t("storefront.auth.signup.name_placeholder")}
      type="text"
    />
  );
};

/** The way to the sign-in screen, for a reader who already has an account. */
export const SignupFooter = () => (
  <AuthScreen.Footer>
    <p className="text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
        <Message message="storefront.auth.signup.have_account" />
      </Suspense>{" "}
      <Suspense fallback={<SkeletonLine className="inline-block h-4 w-12" />}>
        <LocaleLink
          href="/login"
          className="text-primary underline underline-offset-4"
        >
          <Message message="storefront.auth.signup.login" />
        </LocaleLink>
      </Suspense>
    </p>
  </AuthScreen.Footer>
);

export const SignupForm = () => (
  <>
    <AuthScreen.Body>
      <ActionForm.Root action={signupAction} className="grid gap-4">
        <LocaleField />
        <TenantIdField />

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="storefront.auth.signup.name_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Suspense fallback={<Skeleton className="h-10 w-full" />}>
              <NameInput />
            </Suspense>
          </Field.Content>
        </Field.Root>

        <Suspense fallback={null}>
          <BirthDateField />
        </Suspense>

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="storefront.auth.fields.email_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              autoComplete="email"
              name="email"
              placeholder="your@email.com"
              type="email"
            />
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="storefront.auth.fields.password_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <PasswordInput.Root>
              <PasswordInput.Control
                autoComplete="new-password"
                name="password"
                placeholder="••••••••"
              />
              <PasswordInput.Toggle>
                <Suspense fallback={null}>
                  <Message message="storefront.common.show_password" />
                </Suspense>
              </PasswordInput.Toggle>
            </PasswordInput.Root>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="storefront.auth.signup.password_confirm_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <PasswordInput.Root>
              <PasswordInput.Control
                autoComplete="new-password"
                name="confirmPassword"
                placeholder="••••••••"
              />
              <PasswordInput.Toggle>
                <Suspense fallback={null}>
                  <Message message="storefront.common.show_password" />
                </Suspense>
              </PasswordInput.Toggle>
            </PasswordInput.Root>
          </Field.Content>
        </Field.Root>

        <Suspense fallback={null}>
          <ConsentField />
        </Suspense>

        <ActionForm.Submit className="justify-self-start">
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="storefront.auth.signup.submit" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="storefront.auth.signup.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </ActionForm.Root>

      <Suspense fallback={null}>
        <SocialSignInButtons returnTo="/" />
      </Suspense>
    </AuthScreen.Body>

    <SignupFooter />
  </>
);
