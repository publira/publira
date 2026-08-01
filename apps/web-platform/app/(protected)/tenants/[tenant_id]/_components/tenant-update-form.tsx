"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import * as React from "react";

interface TenantUpdateFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  children: React.ReactNode;
}

export const TenantUpdateForm = ({
  action,
  children,
}: TenantUpdateFormProps) => (
  <ActionForm
    action={action}
    pendingLabel="保存中..."
    showSuccess
    submitClassName="mt-4 ml-auto block"
    submitLabel="保存"
    submitVariant="outline"
  >
    {children}
  </ActionForm>
);
