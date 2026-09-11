import { getMessage } from "@publira/i18n";
import { AuthScreenBody, AuthScreenFooter } from "@publira/layouts/auth-screen";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
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
import { getLocale, loadHostMessages } from "#lib/locale";

import { signupAction } from "../_lib/actions";

/**
 * The one control in this form whose copy cannot be a node: `placeholder` is
 * an attribute, so this input resolves the catalog itself. Its label does not
 * — that is a `<Message>` at the call site — so the wait is the input alone.
 */
const NameInput = async () => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <Input
      id="name"
      name="name"
      placeholder={getMessage(messages, "host.auth.signup.name_placeholder")}
      type="text"
    />
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
