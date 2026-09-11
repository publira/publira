import { AuthScreenBody, AuthScreenFooter } from "@publira/layouts/auth-screen";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { Message } from "#components/message";

import { requestPasswordResetAction } from "../_lib/actions";

export const ResetPasswordForm = () => (
  <>
    <AuthScreenBody>
      <ActionForm action={requestPasswordResetAction} className="grid gap-4">
        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="platform.auth.fields.email_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              name="email"
              placeholder="operator@example.com"
              required
              type="email"
            />
          </FieldContent>
        </Field>
        <ActionFormSubmit className="justify-self-start">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.auth.reset_password.submit" />
          </Suspense>
        </ActionFormSubmit>
      </ActionForm>
    </AuthScreenBody>

    <AuthScreenFooter>
      <p>
        <Link
          className="text-primary underline underline-offset-4"
          href="/login"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.auth.reset_password.to_login" />
          </Suspense>
        </Link>
      </p>
    </AuthScreenFooter>
  </>
);
