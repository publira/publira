import * as AuthScreen from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import * as PasswordInput from "@publira/ui-components/password-input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

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
    <AuthScreen.Body>
      <ActionForm.Root action={loginAction} className="grid gap-4">
        {nextField}

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

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="platform.auth.fields.password_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <PasswordInput.Root>
              <PasswordInput.Control
                autoComplete="current-password"
                name="password"
                placeholder="••••••••"
                required
              />
              <PasswordInput.Toggle>
                <Suspense fallback={null}>
                  <Message message="platform.common.show_password" />
                </Suspense>
              </PasswordInput.Toggle>
            </PasswordInput.Root>
          </Field.Content>
        </Field.Root>

        {flash}
        <ActionForm.Submit className="justify-self-start">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.auth.login.submit" />
          </Suspense>
        </ActionForm.Submit>
      </ActionForm.Root>
    </AuthScreen.Body>

    <AuthScreen.Footer>
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
    </AuthScreen.Footer>
  </>
);
