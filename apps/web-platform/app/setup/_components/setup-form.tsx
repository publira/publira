import { getLocaleLabel, getLocales, getMessage } from "@publira/i18n";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { getInitialLocaleCandidate } from "#lib/initial-locale";
import { loadPlatformMessages } from "#lib/locale";

import { setupAction } from "../_lib/actions";
import { SetupMessage } from "./setup-message";

export const SetupForm = async () => {
  // Nothing is stored yet, so the header decides both the language this screen
  // renders in and which option opens selected. The saved value is whatever the
  // operator submits from this list.
  const initialDefaultLocale = await getInitialLocaleCandidate();
  const messages = await loadPlatformMessages(initialDefaultLocale);
  const localeItems = getLocales().map((value) => ({
    label: getLocaleLabel(value),
    value,
  }));

  return (
    <ActionForm action={setupAction} className="space-y-4">
      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <SetupMessage message="platform.auth.setup.name_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="name"
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
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <SetupMessage message="platform.auth.fields.email_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="email"
            name="email"
            placeholder="admin@example.com"
            required
            type="email"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <SetupMessage message="platform.auth.fields.password_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="new-password"
            name="password"
            placeholder="••••••••"
            required
            type="password"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
            <SetupMessage message="platform.auth.setup.confirm_password_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="new-password"
            name="confirmPassword"
            placeholder="••••••••"
            required
            type="password"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <SetupMessage message="platform.auth.setup.default_locale_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Select
            defaultValue={initialDefaultLocale}
            items={localeItems}
            name="default_locale"
            placeholder={getMessage(
              messages,
              "platform.auth.setup.default_locale_placeholder"
            )}
          />
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <SetupMessage message="platform.auth.setup.default_locale_help" />
            </Suspense>
          </FieldDescription>
        </FieldContent>
      </Field>

      <ActionFormSubmit className="mt-2 w-full">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <SetupMessage message="platform.auth.setup.submit" />
        </Suspense>
      </ActionFormSubmit>
    </ActionForm>
  );
};
