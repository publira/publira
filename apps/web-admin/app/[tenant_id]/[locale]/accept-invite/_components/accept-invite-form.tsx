import * as AuthScreen from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import * as PasswordInput from "@publira/ui-components/password-input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { acceptInviteAction } from "../_lib/actions";
import { NameField } from "./name-field";

export const AcceptInviteForm = ({
  token,
  email,
  tenantId,
  accountExists,
}: {
  token: string;
  email: string;
  tenantId: string;
  accountExists: boolean;
}) => (
  <ActionForm.Root action={acceptInviteAction} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="token" type="hidden" value={token} />
    <input name="account_exists" type="hidden" value={String(accountExists)} />
    <input name="email" type="hidden" value={email} />

    {accountExists ? (
      <AuthScreen.Note>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.accept_invite.account_exists" />
        </Suspense>
      </AuthScreen.Note>
    ) : (
      <ActionForm.Fieldset className="grid gap-4">
        <Suspense fallback={<Skeleton className="h-11 w-full" />}>
          <NameField />
        </Suspense>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.auth.fields.password_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <PasswordInput.Root>
              <PasswordInput.Control
                autoComplete="new-password"
                name="password"
                placeholder="••••••••"
                required
              />
              <PasswordInput.Toggle>
                <Suspense fallback={null}>
                  <Message message="admin.common.show_password" />
                </Suspense>
              </PasswordInput.Toggle>
            </PasswordInput.Root>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="admin.auth.accept_invite.password_confirm_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <PasswordInput.Root>
              <PasswordInput.Control
                autoComplete="new-password"
                name="confirm_password"
                placeholder="••••••••"
                required
              />
              <PasswordInput.Toggle>
                <Suspense fallback={null}>
                  <Message message="admin.common.show_password" />
                </Suspense>
              </PasswordInput.Toggle>
            </PasswordInput.Root>
          </Field.Content>
        </Field.Root>
      </ActionForm.Fieldset>
    )}

    <ActionForm.Submit className="justify-self-start">
      <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
        <Message message="admin.auth.accept_invite.submit" />
      </Suspense>
    </ActionForm.Submit>
  </ActionForm.Root>
);
