import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import * as PasswordInput from "@publira/ui-components/password-input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { requestPlatformEmailChangeAction } from "../_lib/actions";

export const EmailChangeForm = () => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
            <Message message="platform.settings.email_change_title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="platform.settings.email_change_description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>
    <ActionForm.Root
      action={requestPlatformEmailChangeAction}
      className="grid gap-4"
    >
      <Field.Root>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.settings.email_change_current" />
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
            <Message message="platform.settings.email_change_new" />
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
            <Message message="platform.settings.email_change_password" />
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
                <Message message="platform.common.show_password" />
              </Suspense>
            </PasswordInput.Toggle>
          </PasswordInput.Root>
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="platform.settings.email_change_password_help" />
            </Suspense>
          </Field.Description>
        </Field.Content>
      </Field.Root>

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.settings.email_change_submit" />
          </Suspense>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </ConsoleSection.Root>
);
