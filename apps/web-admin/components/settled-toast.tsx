"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import * as Toast from "@publira/ui-components/toast";

/**
 * Raises the message a successful submission of the surrounding `ActionForm`
 * returned as a toast, for a form whose success changes or removes what it
 * sits next to, so a message left under the form would describe what is gone.
 */
export const SettledToast = () => {
  const { add } = Toast.useManager();
  ActionForm.useSettled((state) => {
    if (state?.ok) {
      add({ title: state.message, type: "success" });
    }
  });

  return null;
};
