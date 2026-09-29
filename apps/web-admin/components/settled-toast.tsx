"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { useToastManager } from "@publira/ui-components/toast";

/**
 * Raises the message a successful submission of the surrounding `ActionForm`
 * returned as a toast, for a form whose success changes or removes what it
 * sits next to, so a message left under the form would describe what is gone.
 */
export const SettledToast = () => {
  const { add } = useToastManager();
  useActionFormSettled((state) => {
    if (state?.ok) {
      add({ title: state.message, type: "success" });
    }
  });

  return null;
};
