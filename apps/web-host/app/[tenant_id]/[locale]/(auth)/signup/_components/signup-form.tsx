import { getMessage } from "@publira/i18n";
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

const fieldClassName =
  "mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:ring-2 focus:ring-primary focus:outline-none";

/** The only localized attribute in this form needs a string rather than a node. */
const NameField = async () => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <div>
      <label htmlFor="name" className="block text-sm font-medium">
        {getMessage(messages, "host.auth.signup.name_label")}
      </label>
      <input
        id="name"
        name="name"
        type="text"
        placeholder={getMessage(messages, "host.auth.signup.name_placeholder")}
        className={fieldClassName}
      />
    </div>
  );
};

export const SignupForm = () => (
  <>
    <div className="space-y-6 rounded-lg border border-border/70 bg-card p-8">
      <ActionForm action={signupAction} className="space-y-4">
        <LocaleField />
        <TenantIdField />

        <Suspense fallback={<Skeleton className="h-16 w-full" />}>
          <NameField />
        </Suspense>
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="host.auth.fields.email_label" />
            </Suspense>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="your@email.com"
            className={fieldClassName}
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="host.auth.fields.password_label" />
            </Suspense>
          </label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            className={fieldClassName}
          />
        </div>
        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="host.auth.signup.password_confirm_label" />
            </Suspense>
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            placeholder="••••••••"
            className={fieldClassName}
          />
        </div>
        <ActionFormSubmit className="mt-6 w-full">
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
    </div>

    <div className="mt-4 text-center text-sm">
      <span className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="host.auth.signup.have_account" />
        </Suspense>
      </span>{" "}
      <LocaleLink
        href="/login"
        className="font-medium text-primary hover:underline"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="host.auth.signup.login" />
        </Suspense>
      </LocaleLink>
    </div>
  </>
);
