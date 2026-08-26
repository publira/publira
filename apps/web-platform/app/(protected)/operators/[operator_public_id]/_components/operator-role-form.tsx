"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Select } from "@publira/ui-components/select";
import type { ReactNode } from "react";

export interface OperatorRoleFormCopy {
  pendingLabel: ReactNode;
  roleLabel: ReactNode;
  rolePlaceholder: string;
  submitLabel: ReactNode;
}

interface OperatorRoleFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  copy: OperatorRoleFormCopy;
  currentRole: string;
  disabled?: boolean;
  operatorPublicId: string;
  roleItems: readonly { label: string; value: string }[];
}

export const OperatorRoleForm = ({
  action,
  copy,
  currentRole,
  disabled,
  operatorPublicId,
  roleItems,
}: OperatorRoleFormProps) => (
  <ActionForm action={action}>
    {({ isPending, state }) => (
      <>
        <input
          name="operator_public_id"
          type="hidden"
          value={operatorPublicId}
        />
        <div className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="operator_role" required={!disabled}>
              {copy.roleLabel}
            </FieldLabel>
            <FieldContent>
              <Select
                defaultValue={currentRole}
                disabled={disabled}
                id="operator_role"
                items={roleItems}
                key={currentRole}
                name="operator_role"
                placeholder={copy.rolePlaceholder}
                required={!disabled}
              />
            </FieldContent>
          </Field>
        </div>
        {state ? (
          <FormMessage
            className="mt-3"
            variant={state.ok ? "success" : "destructive"}
          >
            {state.message}
          </FormMessage>
        ) : null}
        {disabled ? null : (
          <div className="mt-4 flex justify-end">
            <Button disabled={isPending} type="submit" variant="outline">
              {isPending ? copy.pendingLabel : copy.submitLabel}
            </Button>
          </div>
        )}
      </>
    )}
  </ActionForm>
);
