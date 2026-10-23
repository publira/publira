import { AuthScreenBody, AuthScreenFooter } from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantIdField } from "#components/tenant-id-field";

import { requestPasswordResetAction } from "../_lib/actions";

export const ResetPasswordForm = () => (
  <>
    <AuthScreenBody>
      <ActionForm.Root
        action={requestPasswordResetAction}
        className="grid gap-4"
      >
        <LocaleField />
        <TenantIdField />

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="storefront.auth.fields.email_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              autoComplete="email"
              name="email"
              placeholder="your@email.com"
              required
              type="email"
            />
          </Field.Content>
        </Field.Root>
        <ActionForm.Submit className="justify-self-start">
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="storefront.auth.reset_password.submit" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="storefront.auth.reset_password.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </ActionForm.Root>
    </AuthScreenBody>

    <AuthScreenFooter>
      <p>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-32" />}>
          <LocaleLink
            href="/login"
            className="text-primary underline underline-offset-4"
          >
            <Message message="storefront.auth.fields.to_login" />
          </LocaleLink>
        </Suspense>
      </p>
    </AuthScreenFooter>
  </>
);
