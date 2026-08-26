import { getMessage } from "@publira/i18n";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { Message } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import { getOperatorRoleSelectItems } from "#lib/operator-labels";

import { updateOperatorRoleAction } from "../_lib/actions";

export const OperatorRoleForm = async ({
  currentRole,
  disabled,
  operatorPublicId,
}: {
  currentRole: string;
  disabled?: boolean;
  operatorPublicId: string;
}) => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return (
    <ActionForm action={updateOperatorRoleAction}>
      <input name="operator_public_id" type="hidden" value={operatorPublicId} />
      <div className="grid gap-4">
        <Field>
          <FieldLabel htmlFor="operator_role" required={!disabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="platform.common.role" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Suspense fallback={<Skeleton className="h-10 w-full" />}>
              <Select
                defaultValue={currentRole}
                disabled={disabled}
                id="operator_role"
                items={getOperatorRoleSelectItems(messages)}
                key={currentRole}
                name="operator_role"
                placeholder={getMessage(
                  messages,
                  "platform.common.select_placeholder"
                )}
                required={!disabled}
              />
            </Suspense>
          </FieldContent>
        </Field>
      </div>
      {disabled ? null : (
        <div className="mt-4 flex justify-end">
          <ActionFormSubmit variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="platform.common.save" />
            </Suspense>
          </ActionFormSubmit>
        </div>
      )}
    </ActionForm>
  );
};
