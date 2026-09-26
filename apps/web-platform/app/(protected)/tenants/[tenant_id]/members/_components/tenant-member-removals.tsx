"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { createContext, use, useState } from "react";
import type { ReactNode } from "react";

const ReportRemovalContext = createContext<
  ((message: string | null) => void) | null
>(null);

/**
 * Where the members list says a removal went through. The removed row leaves
 * the list with its form, so the row cannot carry that message itself.
 */
export const TenantMemberRemovals = ({ children }: { children: ReactNode }) => {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <ReportRemovalContext value={setMessage}>
      {message ? <FormMessage variant="success">{message}</FormMessage> : null}
      {children}
    </ReportRemovalContext>
  );
};

/**
 * Hands a successful removal's message to `TenantMemberRemovals`; a refused one
 * stays on its row, and clears the last success so the two do not disagree.
 */
export const ReportTenantMemberRemoval = () => {
  const report = use(ReportRemovalContext);
  useActionFormSettled((state) => {
    report?.(state?.ok ? state.message : null);
  });

  return null;
};
