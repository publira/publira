import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import type { LabelActionState, LabelListItem } from "../label-types";

interface LabelFormProps {
  mode: "create" | "update";
  action: (
    prevState: LabelActionState,
    formData: FormData
  ) => Promise<LabelActionState>;
  initialLabel?: LabelListItem;
  tenantId: string;
}

/**
 * Awaits the catalog for the name's placeholder, which is an attribute rather
 * than a node. A create redirects from the Action (see `createLabelAction`).
 */
export const LabelForm = async ({
  mode,
  action,
  initialLabel,
  tenantId,
}: LabelFormProps) => {
  const t = await getMessages();
  const isUpdate = mode === "update";

  return (
    <ActionForm action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="label_id" type="hidden" value={initialLabel?.id ?? ""} />

      <ActionFormFieldset className="grid gap-4">
        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.labels.form.name" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={initialLabel?.name}
              name="name"
              placeholder={t("admin.labels.form.name_placeholder")}
              required
              type="text"
            />
          </FieldContent>
        </Field>

        {isUpdate ? null : (
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.labels.form.eye_catch" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="eye_catch_image"
                type="file"
              />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.labels.form.eye_catch_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>
        )}
      </ActionFormFieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              {isUpdate ? (
                <Message message="admin.labels.form.update" />
              ) : (
                <Message message="admin.labels.form.create" />
              )}
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.labels.form.submitting" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  );
};
