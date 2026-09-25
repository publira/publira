"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEventHandler } from "react";

import { ClientMessage } from "#components/client-message";
import { EyeCatchImageField } from "#components/eye-catch/image-field";
import { useTenantId } from "#lib/use-tenant-id";

import type { LabelActionState, LabelListItem } from "../label-types";

interface LabelEyeCatchFormProps {
  action: (
    prevState: LabelActionState,
    formData: FormData
  ) => Promise<LabelActionState>;
  initialLabel: LabelListItem;
}

export const LabelEyeCatchForm = ({
  action,
  initialLabel,
}: LabelEyeCatchFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [clearEyeCatchImage, setClearEyeCatchImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [selectedVariantType, setSelectedVariantType] = useState<string | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveLabel = state?.ok ? state.label : initialLabel;
  const variants = effectiveLabel.eyeCatchImageVariants ?? [];
  const hasVariants = variants.length > 0;

  useEffect(
    () => () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    },
    [localPreviewUrl]
  );

  const handleVariantImageClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImageFileChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >((event) => {
    const file = event.currentTarget.files?.[0];
    if (file) {
      setLocalPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return URL.createObjectURL(file);
      });
      setClearEyeCatchImage(false);
    }
  }, []);

  const handleDeleteToggle = useCallback(() => {
    setClearEyeCatchImage((current) => !current);
  }, []);

  return (
    <form action={formAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={initialLabel.publicId} />
      <input name="name" type="hidden" value={initialLabel.name} />
      <input
        name="current_eye_catch_image_updated_at"
        type="hidden"
        value={effectiveLabel.eyeCatchImageUpdatedAt}
      />

      <EyeCatchImageField
        clearEyeCatchImage={clearEyeCatchImage}
        disabled={isPending}
        fileInputId="label_eye_catch_image"
        fileInputRef={fileInputRef}
        hasVariants={hasVariants}
        localPreviewUrl={localPreviewUrl}
        onDeleteToggle={handleDeleteToggle}
        onImageFileChange={handleImageFileChange}
        onVariantImageClick={handleVariantImageClick}
        onVariantTypeChange={setSelectedVariantType}
        selectedVariantType={selectedVariantType}
        variants={variants}
      />

      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}

      <div className="flex justify-end">
        <Button disabled={isPending} type="submit">
          <ActionFormIdle>
            <ClientMessage message="admin.labels.form.eye_catch_update" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="admin.labels.form.submitting" />
          </ActionFormPending>
        </Button>
      </div>
    </form>
  );
};
