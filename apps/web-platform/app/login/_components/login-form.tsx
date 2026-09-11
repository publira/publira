import { AuthScreenBody, AuthScreenFooter } from "@publira/layouts/auth-screen";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { Message } from "#components/message";

import { loginAction } from "../_lib/actions";

export const LoginForm = ({
  flash,
  nextField,
}: {
  flash: ReactNode;
  nextField: ReactNode;
}) => (
  <>
    <AuthScreenBody>
      <ActionForm action={loginAction} className="grid gap-4">
        {nextField}

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

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="platform.auth.fields.password_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="current-password"
              name="password"
              placeholder="••••••••"
              required
              type="password"
            />
          </FieldContent>
        </Field>

        {flash}
        <ActionFormSubmit className="justify-self-start">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.auth.login.submit" />
          </Suspense>
        </ActionFormSubmit>
      </ActionForm>
    </AuthScreenBody>

    <AuthScreenFooter>
      <p>
        <Link
          className="text-primary underline underline-offset-4"
          href="/reset-password"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
            <Message message="platform.auth.login.forgot_password" />
          </Suspense>
        </Link>
      </p>
    </AuthScreenFooter>
  </>
);
