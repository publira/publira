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
import { useActionState, useMemo, useState } from "react";

import type { PlatformDefaultTimezoneActionState } from "../../_lib/actions";

export interface PlatformTimezoneFormCopy {
  description: string;
  emptyMessage: string;
  fieldDescription: string;
  label: string;
  placeholder: string;
  reloadWarning: string;
  saveLabel: string;
  savingLabel: string;
  title: string;
}

interface PlatformTimezoneFormProps {
  action: (
    prevState: PlatformDefaultTimezoneActionState,
    formData: FormData
  ) => Promise<PlatformDefaultTimezoneActionState>;
  copy: PlatformTimezoneFormCopy;
  initialTimezone: string;
  loadErrorMessage?: string;
}

export const PlatformTimezoneForm = ({
  action,
  copy,
  initialTimezone,
  loadErrorMessage,
}: PlatformTimezoneFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);
  const [timezone, setTimezone] = useState(initialTimezone);

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
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:max-w-lg">
          <input name="default_timezone" type="hidden" value={timezone} />

          <Field>
            <FieldLabel htmlFor="default_timezone">{copy.label}</FieldLabel>
            <FieldContent>
              <Combobox
                disabled={hasLoadError}
                emptyMessage={copy.emptyMessage}
                id="default_timezone"
                items={items}
                onValueChange={setTimezone}
                placeholder={copy.placeholder}
                value={timezone}
              />
              <FieldDescription>{copy.fieldDescription}</FieldDescription>
            </FieldContent>
          </Field>

          {loadErrorMessage ? (
            <FormMessage variant="destructive">
              {loadErrorMessage}
              {copy.reloadWarning}
            </FormMessage>
          ) : null}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={hasLoadError || isPending} type="submit">
              {isPending ? copy.savingLabel : copy.saveLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
