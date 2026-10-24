import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import * as ImageCropDialog from "#components/image-crop/crop-dialog";
import { Message } from "#components/message";

import type { EyeCatchEntity } from "./aspect-messages";
import {
  EyeCatchAspectNameMessage,
  EyeCatchAspectUsageMessage,
} from "./aspect-messages";
import * as EyeCatchAspect from "./aspect-slot";
import { EYE_CATCH_ASPECTS } from "./aspects";
import type { EyeCatchAspectActionState, EyeCatchVariantItem } from "./types";

interface EyeCatchAspectImagesProps {
  /** The kind of record the ratios belong to. */
  entity: EyeCatchEntity;
  /** The ID of the record the ratios belong to. */
  id: string;
  tenantId: string;
  /** The images the eye-catch currently holds, across every ratio. */
  variants: EyeCatchVariantItem[];
  uploadAction: (
    prevState: EyeCatchAspectActionState,
    formData: FormData
  ) => Promise<EyeCatchAspectActionState>;
}

/** The hidden field each record's upload action reads its ID from. */
const ID_FIELDS: Record<EyeCatchEntity, string> = {
  campaign_banner: "campaign_banner_id",
  episode: "episode_id",
  genre: "genre_id",
  label: "label_id",
  series: "series_id",
};

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
  entity,
  id,
  tenantId,
  uploadAction,
  variants,
}: EyeCatchAspectImagesProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="admin.eye_catch.aspect.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.eye_catch.aspect.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>
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
            <ActionForm.Root
              action={uploadAction}
              className="grid gap-3 border border-border p-3"
              key={variantType}
            >
              <input name="tenant_id" type="hidden" value={tenantId} />
              <input name={ID_FIELDS[entity]} type="hidden" value={id} />
              <input name="variant_type" type="hidden" value={variantType} />

              <EyeCatchAspect.Root
                aspect={aspect}
                currentUrl={current?.url ?? ""}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                      <EyeCatchAspectNameMessage variantType={variantType} />
                    </Suspense>
                  </p>
                  {current ? (
                    <p className="text-xs text-muted-foreground">
                      {current.width}&times;{current.height}
                    </p>
                  ) : null}
                </div>

                <p className="text-xs text-muted-foreground">
                  <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                    <EyeCatchAspectUsageMessage
                      entity={entity}
                      variantType={variantType}
                    />
                  </Suspense>
                </p>

                <EyeCatchAspect.Picker>
                  <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
                    <Message message="admin.eye_catch.aspect.empty" />
                  </Suspense>
                </EyeCatchAspect.Picker>

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
                  <EyeCatchAspect.FileInput />
                  <EyeCatchAspect.Adjust>
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message message="admin.image_crop.adjust" />
                    </Suspense>
                  </EyeCatchAspect.Adjust>
                  <EyeCatchAspect.Upload>
                    <ActionForm.Idle>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="admin.eye_catch.aspect.upload" />
                      </Suspense>
                    </ActionForm.Idle>
                    <ActionForm.Pending>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-20" />}
                      >
                        <Message message="admin.eye_catch.aspect.uploading" />
                      </Suspense>
                    </ActionForm.Pending>
                  </EyeCatchAspect.Upload>
                </div>

                <EyeCatchAspect.CropDialog>
                  <ImageCropDialog.Title>
                    <EyeCatchAspect.CropTitle />
                  </ImageCropDialog.Title>
                </EyeCatchAspect.CropDialog>
              </EyeCatchAspect.Root>
            </ActionForm.Root>
          );
        })}
      </div>
    )}
  </ConsoleSection.Root>
);
