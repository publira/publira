"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import { Card, CardContent } from "@publira/ui-components/card";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEventHandler } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { EyeCatchImageField } from "#components/eye-catch/image-field";
import { useTenantId } from "#lib/use-tenant-id";

import type { SeriesActionState, SeriesListItem } from "../series-types";

interface SeriesEyeCatchFormProps {
  initialSeries: SeriesListItem;
  action: (
    prevState: SeriesActionState,
    formData: FormData
  ) => Promise<SeriesActionState>;
}

export const SeriesEyeCatchForm = ({
  initialSeries,
  action,
}: SeriesEyeCatchFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [clearEyeCatchImage, setClearEyeCatchImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [selectedVariantType, setSelectedVariantType] = useState<string | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveSeries = state?.ok ? state.series : initialSeries;
  const variants = effectiveSeries.eyeCatchImageVariants ?? [];
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
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input
            name="public_id"
            type="hidden"
            value={initialSeries.publicId}
          />
          <input name="title" type="hidden" value={initialSeries.title} />
          <input name="synopsis" type="hidden" value={initialSeries.synopsis} />
          <input
            name="reading_period_hours"
            type="hidden"
            value={String(initialSeries.readingPeriodHours)}
          />
          <input
            name="label_public_id"
            type="hidden"
            value={initialSeries.labelPublicId}
          />
          <input
            name="published_at"
            type="hidden"
            value={initialSeries.publishedAt}
          />
          <input
            name="current_eye_catch_image_updated_at"
            type="hidden"
            value={effectiveSeries.eyeCatchImageUpdatedAt}
          />
          {initialSeries.creatorPublicIds.map((publicId) => (
            <input
              key={publicId}
              name="creator_public_ids"
              type="hidden"
              value={publicId}
            />
          ))}
          {initialSeries.isPublished ? (
            <input name="is_published" type="hidden" value="on" />
          ) : null}

          <EyeCatchImageField
            clearEyeCatchImage={clearEyeCatchImage}
            fileInputId="series_eye_catch_image"
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
                ? getMessage(messages, "admin.series.form.submitting")
                : getMessage(messages, "admin.series.form.eye_catch_update")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
