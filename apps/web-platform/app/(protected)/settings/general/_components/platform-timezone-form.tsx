"use client";

import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Combobox } from "@publira/ui-components/combobox";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { listSupportedTimeZones } from "@publira/utils";
import { getMessage } from "@publira/utils/i18n";
import { useActionState, useMemo, useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";

import type { PlatformDefaultTimezoneActionState } from "../../_lib/actions";

interface PlatformTimezoneFormProps {
  action: (
    prevState: PlatformDefaultTimezoneActionState,
    formData: FormData
  ) => Promise<PlatformDefaultTimezoneActionState>;
  initialTimezone: string;
  loadErrorMessage?: string;
}

export const PlatformTimezoneForm = ({
  action,
  initialTimezone,
  loadErrorMessage,
}: PlatformTimezoneFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);
  const [timezone, setTimezone] = useState(initialTimezone);
  const messages = useClientMessages();

  // A failed read hands the form `DEFAULT_TIME_ZONE` as a stand-in, not the
  // stored value, so saving from that state would overwrite the real default
  // with the fallback. Editing stays closed until the read succeeds.
  const hasLoadError = Boolean(loadErrorMessage);

  const items = useMemo<ComboboxItem[]>(() => {
    const zones = listSupportedTimeZones();
    // A stored alias (`Asia/Calcutta`) is valid but is not always enumerated by
    // the runtime's ICU build, so keep it selectable instead of dropping it.
    const values =
      !initialTimezone || zones.includes(initialTimezone)
        ? zones
        : [initialTimezone, ...zones];

    return values.map((zone) => ({ label: zone, value: zone }));
  }, [initialTimezone]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ClientMessage message="platform.settings.default_timezone_title" />
        </CardTitle>
        <CardDescription>
          <ClientMessage message="platform.settings.default_timezone_description" />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:max-w-lg">
          <input name="default_timezone" type="hidden" value={timezone} />

          <Field>
            <FieldLabel htmlFor="default_timezone">
              <ClientMessage message="platform.settings.default_timezone_label" />
            </FieldLabel>
            <FieldContent>
              <Combobox
                disabled={hasLoadError}
                emptyMessage={getMessage(
                  messages,
                  "platform.settings.default_timezone_empty"
                )}
                id="default_timezone"
                items={items}
                onValueChange={setTimezone}
                placeholder={getMessage(
                  messages,
                  "platform.settings.default_timezone_placeholder"
                )}
                value={timezone}
              />
              <FieldDescription>
                <ClientMessage message="platform.settings.default_timezone_help" />
              </FieldDescription>
            </FieldContent>
          </Field>

          {loadErrorMessage ? (
            <FormMessage variant="destructive">
              {loadErrorMessage}
              <ClientMessage message="platform.settings.default_timezone_reload" />
            </FormMessage>
          ) : null}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={hasLoadError || isPending} type="submit">
              <ClientMessage message="platform.settings.default_timezone_save" />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
