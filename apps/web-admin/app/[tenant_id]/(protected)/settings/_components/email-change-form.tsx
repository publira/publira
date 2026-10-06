import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import {
  PasswordInput,
  PasswordInputControl,
  PasswordInputToggle,
} from "@publira/ui-components/password-input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";

import { requestEmailChangeAction } from "../_lib/actions";

interface EmailChangeFormProps {
  tenantId: string;
}

export const EmailChangeForm = ({ tenantId }: EmailChangeFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="admin.settings.email_change.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.email_change.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <ActionForm action={requestEmailChangeAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />

      <ActionFormFieldset className="grid gap-4">
        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.settings.email_change.current_email" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              name="current_email"
              placeholder="current@example.com"
              required
              type="email"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.settings.email_change.new_email" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              name="new_email"
              placeholder="new@example.com"
              required
              type="email"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.settings.email_change.current_password" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <PasswordInput>
              <PasswordInputControl
                autoComplete="current-password"
                name="current_password"
                placeholder="••••••••"
                required
              />
              <PasswordInputToggle>
                <Suspense fallback={null}>
                  <Message message="admin.common.show_password" />
                </Suspense>
              </PasswordInputToggle>
            </PasswordInput>
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.email_change.password_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>
      </ActionFormFieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionFormSubmit>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <ActionFormIdle>
              <Message message="admin.settings.email_change.submit" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.settings.email_change.submitting" />
            </ActionFormPending>
          </Suspense>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </AdminSection>
);
