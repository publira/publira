import {
  ActionForm,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  ComboboxEmpty,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";

import { updatePlatformDefaultTimezoneAction } from "../../_lib/actions";
import { PlatformTimezoneCombobox } from "./platform-timezone-combobox";

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
    <PlatformSection>
      <PlatformSectionHeader>
        <PlatformSectionHeading>
          <PlatformSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="platform.settings.default_timezone_title" />
            </Suspense>
          </PlatformSectionTitle>
          <PlatformSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="platform.settings.default_timezone_description" />
            </Suspense>
          </PlatformSectionDescription>
        </PlatformSectionHeading>
      </PlatformSectionHeader>
      <ActionForm
        action={updatePlatformDefaultTimezoneAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.settings.default_timezone_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <PlatformTimezoneCombobox
              disabled={hasLoadError}
              initialTimezone={initialTimezone}
            >
              <ComboboxPopup>
                <ComboboxEmpty>
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="platform.settings.default_timezone_empty" />
                  </Suspense>
                </ComboboxEmpty>
                <ComboboxItems />
              </ComboboxPopup>
            </PlatformTimezoneCombobox>
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="platform.settings.default_timezone_help" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            {loadErrorMessage}
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.settings.default_timezone_reload" />
            </Suspense>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionFormSubmit disabled={hasLoadError}>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="platform.settings.default_timezone_save" />
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </PlatformSection>
  );
};
