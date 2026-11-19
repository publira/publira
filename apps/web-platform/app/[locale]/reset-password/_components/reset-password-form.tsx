import * as AuthScreen from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";

import { requestPasswordResetAction } from "../_lib/actions";

export const ResetPasswordForm = () => (
  <>
    <AuthScreen.Body>
      <ActionForm.Root
        action={requestPasswordResetAction}
        className="grid gap-4"
      >
        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="platform.auth.fields.email_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              autoComplete="email"
              name="email"
              placeholder="operator@example.com"
              required
              type="email"
            />
          </Field.Content>
        </Field.Root>
        <ActionForm.Submit className="justify-self-start">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.auth.reset_password.submit" />
          </Suspense>
        </ActionForm.Submit>
      </ActionForm.Root>
    </AuthScreen.Body>

    <AuthScreen.Footer>
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
    </AuthScreen.Footer>
  </>
);
