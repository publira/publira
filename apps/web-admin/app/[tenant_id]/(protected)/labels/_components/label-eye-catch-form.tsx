"use client";

import { Button } from "@publira/ui-components/button";
import { Card, CardContent } from "@publira/ui-components/card";
import { FormMessage } from "@publira/ui-components/form-message";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEventHandler } from "react";

import { useAdminMessage } from "#components/client-message";
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
  const t = useAdminMessage();
  const tenantId = useTenantId();
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(action, null);
  const [clearEyeCatchImage, setClearEyeCatchImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [selectedVariantType, setSelectedVariantType] = useState<string | null>(
    null
  );
  const [prevLabelPublicId, setPrevLabelPublicId] = useState(
    initialLabel.publicId
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveLabel = state?.ok ? state.label : initialLabel;
  const variants = effectiveLabel.eyeCatchImageVariants ?? [];
  const hasVariants = variants.length > 0;

  if (initialLabel.publicId !== prevLabelPublicId) {
    setPrevLabelPublicId(initialLabel.publicId);
    setClearEyeCatchImage(false);
    if (localPreviewUrl) {
      URL.revokeObjectURL(localPreviewUrl);
    }
    setLocalPreviewUrl("");
    setSelectedVariantType(null);
  }

  useEffect(
    () => () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    },
    [localPreviewUrl]
  );

  useEffect(() => {
    if (!state?.ok) {
      return;
    }
    router.refresh();
  }, [router, state]);

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
    <Card>
      <CardContent className="pt-6">
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
              {isPending
                ? t("admin.labels.form.submitting")
                : t("admin.labels.form.eye_catch_update")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
