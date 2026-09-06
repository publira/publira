import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
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

import { requestPasswordResetAction } from "../_lib/actions";

export const ResetPasswordForm = () => (
  <>
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <ActionForm action={requestPasswordResetAction} className="space-y-4">
        <LocaleField />
        <TenantIdField />

        <Field>
          <FieldLabel htmlFor="email" required>
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
              required
              type="email"
            />
          </FieldContent>
        </Field>
        <ActionFormSubmit className="mt-2 w-full">
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="host.auth.reset_password.submit" />
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="host.auth.reset_password.submitting" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </ActionForm>
    </div>

    <div className="mt-4 text-center text-sm">
      <LocaleLink
        href="/login"
        className="font-medium text-primary hover:underline"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="host.auth.fields.to_login" />
        </Suspense>
      </LocaleLink>
    </div>
  </>
);
