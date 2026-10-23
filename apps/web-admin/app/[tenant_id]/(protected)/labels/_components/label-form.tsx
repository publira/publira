import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
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
    <ActionForm.Root action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="label_id" type="hidden" value={initialLabel?.id ?? ""} />

      <ActionForm.Fieldset className="grid gap-4">
        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.labels.form.name" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={initialLabel?.name}
              name="name"
              placeholder={t("admin.labels.form.name_placeholder")}
              required
              type="text"
            />
          </Field.Content>
        </Field.Root>

        {isUpdate ? null : (
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.labels.form.eye_catch" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="eye_catch_image"
                type="file"
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.labels.form.eye_catch_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>
        )}
      </ActionForm.Fieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              {isUpdate ? (
                <Message message="admin.labels.form.update" />
              ) : (
                <Message message="admin.labels.form.create" />
              )}
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.labels.form.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  );
};
