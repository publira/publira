"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Select } from "@publira/ui-components/select";

const ROLE_OPTIONS = [
  { label: "スーパー管理者", value: "platform_super_admin" },
  { label: "オペレーター", value: "platform_operator" },
  { label: "監査担当", value: "platform_auditor" },
] as const;

interface OperatorRoleFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  currentRole: string;
  disabled?: boolean;
  operatorPublicId: string;
}

export const OperatorRoleForm = ({
  action,
  currentRole,
  disabled,
  operatorPublicId,
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
              ロール
            </FieldLabel>
            <FieldContent>
              <Select
                defaultValue={currentRole}
                disabled={disabled}
                id="operator_role"
                items={ROLE_OPTIONS}
                key={currentRole}
                name="operator_role"
                placeholder="選択してください"
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
              {isPending ? "保存中..." : "保存"}
            </Button>
          </div>
        )}
      </>
    )}
  </ActionForm>
);
