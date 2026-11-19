import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import * as PasswordInput from "@publira/ui-components/password-input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { requestEmailChangeAction } from "../_lib/actions";

interface EmailChangeFormProps {
  tenantId: string;
}

export const EmailChangeForm = ({ tenantId }: EmailChangeFormProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="admin.settings.email_change.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.email_change.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>
    <ActionForm.Root action={requestEmailChangeAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />

      <ActionForm.Fieldset className="grid gap-4">
        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.settings.email_change.current_email" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              autoComplete="email"
              name="current_email"
              placeholder="current@example.com"
              required
              type="email"
            />
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.settings.email_change.new_email" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              autoComplete="email"
              name="new_email"
              placeholder="new@example.com"
              required
              type="email"
            />
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.settings.email_change.current_password" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <PasswordInput.Root>
              <PasswordInput.Control
                autoComplete="current-password"
                name="current_password"
                placeholder="••••••••"
                required
              />
              <PasswordInput.Toggle>
                <Suspense fallback={null}>
                  <Message message="admin.common.show_password" />
                </Suspense>
              </PasswordInput.Toggle>
            </PasswordInput.Root>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.email_change.password_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>
      </ActionForm.Fieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <ActionForm.Idle>
              <Message message="admin.settings.email_change.submit" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.settings.email_change.submitting" />
            </ActionForm.Pending>
          </Suspense>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </ConsoleSection.Root>
);
