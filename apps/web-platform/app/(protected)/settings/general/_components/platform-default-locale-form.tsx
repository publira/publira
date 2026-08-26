import { getLocaleLabel, getLocales, getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Select } from "@publira/ui-components/select";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { Message } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { updatePlatformDefaultLocaleAction } from "../../_lib/actions";

export const PlatformDefaultLocaleForm = async ({
  initialDefaultLocale,
  loadErrorMessage,
}: {
  initialDefaultLocale: Locale;
  loadErrorMessage?: string;
}) => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);
  const hasLoadError = Boolean(loadErrorMessage);
  const items = getLocales().map((value) => ({
    label: getLocaleLabel(value),
    value,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
            <Message message="platform.settings.default_locale_title" />
          </Suspense>
        </CardTitle>
        <CardDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="platform.settings.default_locale_description" />
          </Suspense>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm
          action={updatePlatformDefaultLocaleAction}
          className="grid gap-4 sm:max-w-lg"
        >
          <Field>
            <FieldLabel htmlFor="default_locale">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.settings.default_locale_label" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Suspense fallback={<Skeleton className="h-10 w-full" />}>
                <Select
                  defaultValue={initialDefaultLocale}
                  disabled={hasLoadError}
                  id="default_locale"
                  items={items}
                  name="default_locale"
                  placeholder={getMessage(
                    messages,
                    "platform.settings.default_locale_placeholder"
                  )}
                />
              </Suspense>
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                  <Message message="platform.settings.default_locale_help" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>

          {loadErrorMessage ? (
            <FormMessage variant="destructive">
              {loadErrorMessage}
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="platform.settings.default_locale_reload" />
              </Suspense>
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <ActionFormSubmit disabled={hasLoadError}>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.settings.default_locale_save" />
              </Suspense>
            </ActionFormSubmit>
          </div>
        </ActionForm>
      </CardContent>
    </Card>
  );
};
