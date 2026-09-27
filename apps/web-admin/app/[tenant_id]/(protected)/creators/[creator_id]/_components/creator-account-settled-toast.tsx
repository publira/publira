"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { useToastManager } from "@publira/ui-components/toast";

/**
 * Announces a link or an unlink. Either one changes the list below the form,
 * so a message left under the form would describe a list that has moved on.
 */
export const CreatorAccountSettledToast = () => {
  const { add } = useToastManager();
  useActionFormSettled((state) => {
    if (state?.ok) {
      add({ title: state.message, type: "success" });
    }
  });

  return null;
};
