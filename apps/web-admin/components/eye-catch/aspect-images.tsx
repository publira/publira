import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ImageCropDialogTitle } from "#components/image-crop/crop-dialog";
import { Message } from "#components/message";

import {
  EyeCatchAspectAdjust,
  EyeCatchAspectCropDialog,
  EyeCatchAspectFileInput,
  EyeCatchAspectPicker,
  EyeCatchAspectSlot,
  EyeCatchAspectUpload,
} from "./aspect-slot";
import { EYE_CATCH_ASPECTS } from "./aspects";
import type { EyeCatchAspectActionState, EyeCatchVariantItem } from "./types";

interface EyeCatchAspectImagesProps {
  /** The hidden field the upload action reads the record's ID from. */
  idField: string;
  /** The ID of the series, label, or genre the ratios belong to. */
  id: string;
  tenantId: string;
  /** The images the eye-catch currently holds, across every ratio. */
  variants: EyeCatchVariantItem[];
  uploadAction: (
    prevState: EyeCatchAspectActionState,
    formData: FormData
  ) => Promise<EyeCatchAspectActionState>;
}

const largestVariant = (
  variants: EyeCatchVariantItem[],
  variantType: string
): EyeCatchVariantItem | undefined =>
  variants
    .filter((variant) => variant.variantType === variantType)
    .toSorted((a, b) => a.width - b.width)
    .at(-1);

/**
 * The per-ratio images of an eye-catch.
 *
 * Each ratio holds its own image and they are independent: replacing one here
 * leaves the other three exactly as they were. Uploading a whole eye-catch
 * above fills all four at once.
 */
export const EyeCatchAspectImages = ({
  id,
  idField,
  tenantId,
  uploadAction,
  variants,
}: EyeCatchAspectImagesProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="admin.eye_catch.aspect.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.eye_catch.aspect.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    {variants.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
          <Message message="admin.eye_catch.aspect.eye_catch_required" />
        </Suspense>
      </p>
    ) : (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {EYE_CATCH_ASPECTS.map((aspect) => {
          const { minHeight, minWidth, variantType } = aspect;
          const current = largestVariant(variants, variantType);

          return (
            <ActionForm
              action={uploadAction}
              className="grid gap-3 border border-border p-3"
              key={variantType}
            >
              <input name="tenant_id" type="hidden" value={tenantId} />
              <input name={idField} type="hidden" value={id} />
              <input name="variant_type" type="hidden" value={variantType} />

              <EyeCatchAspectSlot
                aspect={aspect}
                currentUrl={current?.url ?? ""}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{variantType}</p>
                  {current ? (
                    <p className="text-xs text-muted-foreground">
                      {current.width}&times;{current.height}
                    </p>
                  ) : null}
                </div>

                <EyeCatchAspectPicker>
                  <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
                    <Message message="admin.eye_catch.aspect.empty" />
                  </Suspense>
                </EyeCatchAspectPicker>

                <p className="text-xs text-muted-foreground">
                  <Suspense fallback={<SkeletonLine className="h-3 w-24" />}>
                    <Message
                      message="admin.eye_catch.aspect.minimum"
                      values={{
                        height: String(minHeight),
                        width: String(minWidth),
                      }}
                    />
                  </Suspense>
                </p>

                <div className="grid gap-2">
                  <EyeCatchAspectFileInput />
                  <EyeCatchAspectAdjust>
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message message="admin.image_crop.adjust" />
                    </Suspense>
                  </EyeCatchAspectAdjust>
                  <EyeCatchAspectUpload>
                    <ActionFormIdle>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="admin.eye_catch.aspect.upload" />
                      </Suspense>
                    </ActionFormIdle>
                    <ActionFormPending>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-20" />}
                      >
                        <Message message="admin.eye_catch.aspect.uploading" />
                      </Suspense>
                    </ActionFormPending>
                  </EyeCatchAspectUpload>
                </div>

                <EyeCatchAspectCropDialog>
                  <ImageCropDialogTitle>
                    <Suspense fallback={<SkeletonLine className="h-6 w-48" />}>
                      <Message
                        message="admin.eye_catch.aspect.crop_title"
                        values={{ variant_type: variantType }}
                      />
                    </Suspense>
                  </ImageCropDialogTitle>
                </EyeCatchAspectCropDialog>
              </EyeCatchAspectSlot>
            </ActionForm>
          );
        })}
      </div>
    )}
  </AdminSection>
);
