import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { Message } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { setupAction } from "../_lib/actions";

export const SetupForm = async () => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return (
    <ActionForm action={setupAction} className="space-y-4">
      <Field>
        <FieldLabel htmlFor="name" required>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.auth.setup.name_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="name"
            id="name"
            name="name"
            placeholder={getMessage(
              messages,
              "platform.auth.setup.name_placeholder"
            )}
            required
            type="text"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="email" required>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="platform.auth.fields.email_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="email"
            id="email"
            name="email"
            placeholder="admin@example.com"
            required
            type="email"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="password" required>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="platform.auth.fields.password_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="new-password"
            id="password"
            name="password"
            placeholder="••••••••"
            required
            type="password"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="confirmPassword" required>
          <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
            <Message message="platform.auth.setup.confirm_password_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="new-password"
            id="confirmPassword"
            name="confirmPassword"
            placeholder="••••••••"
            required
            type="password"
          />
        </FieldContent>
      </Field>
      <ActionFormSubmit className="mt-2 w-full">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message message="platform.auth.setup.submit" />
        </Suspense>
      </ActionFormSubmit>
    </ActionForm>
  );
};
