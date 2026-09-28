import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { EyeCatchFormField } from "#components/eye-catch/form-field";
import { Message } from "#components/message";

import type { LabelActionState, LabelListItem } from "../label-types";

interface LabelEyeCatchFormProps {
  action: (
    prevState: LabelActionState,
    formData: FormData
  ) => Promise<LabelActionState>;
  initialLabel: LabelListItem;
  tenantId: string;
}

export const LabelEyeCatchForm = ({
  action,
  initialLabel,
  tenantId,
}: LabelEyeCatchFormProps) => (
  <ActionForm action={action} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="label_id" type="hidden" value={initialLabel.id} />
    <input name="name" type="hidden" value={initialLabel.name} />

    {/* A save refreshes the page with the eye-catch it stored, and the new
        timestamp remounts the field so the picked file and the delete toggle
        do not outlive the save they were sent with. */}
    <EyeCatchFormField
      eyeCatchImageUpdatedAt={initialLabel.eyeCatchImageUpdatedAt}
      fileInputId="label_eye_catch_image"
      key={initialLabel.eyeCatchImageUpdatedAt}
      variants={initialLabel.eyeCatchImageVariants}
    />

    <div className="flex justify-end">
      <ActionFormSubmit>
        <ActionFormIdle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.labels.form.eye_catch_update" />
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
