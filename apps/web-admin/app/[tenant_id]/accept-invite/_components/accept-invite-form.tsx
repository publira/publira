import { AuthScreenNote } from "@publira/layouts/auth-screen";
import {
  ActionForm,
  ActionFormFieldset,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import {
  PasswordInput,
  PasswordInputControl,
  PasswordInputToggle,
} from "@publira/ui-components/password-input";
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
  <ActionForm action={acceptInviteAction} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="token" type="hidden" value={token} />
    <input name="account_exists" type="hidden" value={String(accountExists)} />
    <input name="email" type="hidden" value={email} />

    {accountExists ? (
      <AuthScreenNote>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.accept_invite.account_exists" />
        </Suspense>
      </AuthScreenNote>
    ) : (
      <ActionFormFieldset className="grid gap-4">
        <Suspense fallback={<Skeleton className="h-11 w-full" />}>
          <NameField />
        </Suspense>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.auth.fields.password_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <PasswordInput>
              <PasswordInputControl
                autoComplete="new-password"
                name="password"
                placeholder="••••••••"
                required
              />
              <PasswordInputToggle>
                <Suspense fallback={null}>
                  <Message message="admin.common.show_password" />
                </Suspense>
              </PasswordInputToggle>
            </PasswordInput>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="admin.auth.accept_invite.password_confirm_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <PasswordInput>
              <PasswordInputControl
                autoComplete="new-password"
                name="confirm_password"
                placeholder="••••••••"
                required
              />
              <PasswordInputToggle>
                <Suspense fallback={null}>
                  <Message message="admin.common.show_password" />
                </Suspense>
              </PasswordInputToggle>
            </PasswordInput>
          </FieldContent>
        </Field>
      </ActionFormFieldset>
    )}

    <ActionFormSubmit className="justify-self-start">
      <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
        <Message message="admin.auth.accept_invite.submit" />
      </Suspense>
    </ActionFormSubmit>
  </ActionForm>
);
