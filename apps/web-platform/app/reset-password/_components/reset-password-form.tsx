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
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <ActionForm action={requestPasswordResetAction} className="space-y-4">
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
        <ActionFormSubmit className="mt-2 w-full">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.auth.reset_password.submit" />
          </Suspense>
        </ActionFormSubmit>
      </ActionForm>
    </div>

    <div className="mt-4 text-center text-sm">
      <Link className="font-medium text-primary hover:underline" href="/login">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="platform.auth.reset_password.to_login" />
        </Suspense>
      </Link>
    </div>
  </>
);
