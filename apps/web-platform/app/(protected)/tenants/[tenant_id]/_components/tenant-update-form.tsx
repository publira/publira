"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import type { ReactNode } from "react";

interface TenantUpdateFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  children: ReactNode;
  pendingLabel: ReactNode;
  submitLabel: ReactNode;
}

export const TenantUpdateForm = ({
  action,
  children,
  pendingLabel,
  submitLabel,
}: TenantUpdateFormProps) => (
  <ActionForm
    action={action}
    pendingLabel={pendingLabel}
    showSuccess
    submitClassName="mt-4 ml-auto block"
    submitLabel={submitLabel}
    submitVariant="outline"
  >
    {children}
  </ActionForm>
);
