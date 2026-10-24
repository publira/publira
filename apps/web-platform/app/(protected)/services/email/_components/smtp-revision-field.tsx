"use client";

import * as ActionForm from "@publira/ui-components/action-form";

import type { PlatformEmailSettingsFormState } from "../_lib/actions";

type SavedSettingsState = NonNullable<PlatformEmailSettingsFormState>;

/**
 * The revision the next save is compared against: the one the page was read
 * at, then the one each successful save wrote.
 */
export const SmtpRevisionField = ({ revision }: { revision: string }) => {
  const state = ActionForm.useState<SavedSettingsState>();

  return (
    <input
      name="revision"
      type="hidden"
      value={state?.ok ? state.settings.revision : revision}
    />
  );
};
