import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Combobox from "@publira/ui-components/combobox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { PlatformTimezoneCombobox } from "#components/platform-timezone-combobox";

import { updatePlatformDefaultTimezoneAction } from "../_lib/actions";

interface PlatformTimezoneFormProps {
  initialTimezone: string;
  loadErrorMessage?: string;
}

export const PlatformTimezoneForm = ({
  initialTimezone,
  loadErrorMessage,
}: PlatformTimezoneFormProps) => {
  // A failed read hands the form `DEFAULT_TIME_ZONE` as a stand-in, not the
  // stored value, so saving from that state would overwrite the real default
  // with the fallback. Editing stays closed until the read succeeds.
  const hasLoadError = Boolean(loadErrorMessage);

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="platform.settings.default_timezone_title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="platform.settings.default_timezone_description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updatePlatformDefaultTimezoneAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.settings.default_timezone_label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <PlatformTimezoneCombobox
              disabled={hasLoadError}
              initialTimezone={initialTimezone}
            >
              <Combobox.Popup>
                <Combobox.Empty>
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="platform.settings.default_timezone_empty" />
                  </Suspense>
                </Combobox.Empty>
                <Combobox.Items />
              </Combobox.Popup>
            </PlatformTimezoneCombobox>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="platform.settings.default_timezone_help" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            {loadErrorMessage}
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.settings.default_timezone_reload" />
            </Suspense>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionForm.Submit disabled={hasLoadError}>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="platform.settings.default_timezone_save" />
            </Suspense>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
