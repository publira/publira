"use client";

import { useActionFormState } from "@publira/ui-components/action-form";
import type { ReactNode } from "react";

/**
 * Renders its children until the surrounding `ActionForm`'s Action succeeds,
 * for a control that has nothing left to do once it has: a second submission
 * would ask for what is already done.
 */
export const UntilActionSucceeds = ({ children }: { children: ReactNode }) => {
  const state = useActionFormState();

  return state?.ok ? null : children;
};
