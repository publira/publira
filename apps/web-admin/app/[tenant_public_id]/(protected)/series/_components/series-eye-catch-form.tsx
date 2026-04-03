"use client";

import { Button } from "@publira/ui-components/button";
import { Card, CardContent } from "@publira/ui-components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { cn } from "@publira/utils";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEventHandler } from "react";

import type { SeriesActionState, SeriesListItem } from "../series-types";
import { EyeCatchVariantSelector } from "./eye-catch-variant-selector";

interface SeriesEyeCatchFormProps {
  initialSeries: SeriesListItem;
  tenantPublicId: string;
  action: (
    prevState: SeriesActionState,
    formData: FormData
  ) => Promise<SeriesActionState>;
}

export const SeriesEyeCatchForm = ({
  initialSeries,
  tenantPublicId,
  action,
}: SeriesEyeCatchFormProps) => {
  const router = useRouter();
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

  useEffect(() => {
    setClearEyeCatchImage(false);
    setLocalPreviewUrl("");
    setSelectedVariantType(null);
  }, [initialSeries.publicId]);

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
          <input name="tenant_public_id" type="hidden" value={tenantPublicId} />
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

          <Field>
            <FieldLabel htmlFor="series_eye_catch_image">
              アイキャッチ画像
            </FieldLabel>
            <FieldContent>
              <div className="grid gap-2">
                {!hasVariants || clearEyeCatchImage ? (
                  <button
                    className="relative aspect-[3/4] overflow-hidden rounded-md border-2 border-dashed border-border/60 bg-muted/40 transition-colors hover:border-blue-300"
                    onClick={handleVariantImageClick}
                    type="button"
                  >
                    <div className="flex h-full items-center justify-center">
                      <p className="text-sm text-muted-foreground">
                        {clearEyeCatchImage
                          ? "削除予定です。画像を選択すると差し替えます"
                          : "画像を選択してください"}
                      </p>
                    </div>
                  </button>
                ) : (
                  <EyeCatchVariantSelector
                    localPreviewUrl={localPreviewUrl}
                    onImageClick={handleVariantImageClick}
                    onSelectVariantType={setSelectedVariantType}
                    selectedVariantType={selectedVariantType}
                    variants={variants}
                  />
                )}

                {hasVariants ? (
                  <div className="pt-1">
                    <button
                      className={cn(
                        "text-sm underline underline-offset-4",
                        clearEyeCatchImage
                          ? "text-destructive"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      onClick={handleDeleteToggle}
                      type="button"
                    >
                      {clearEyeCatchImage
                        ? "削除を取り消す"
                        : "現在のアイキャッチ画像を削除する"}
                    </button>
                  </div>
                ) : null}
              </div>

              <Input
                accept="image/jpeg,image/png,image/webp"
                id="series_eye_catch_image"
                name="eye_catch_image"
                onChange={handleImageFileChange}
                ref={fileInputRef}
                style={{ display: "none" }}
                type="file"
              />
              <input
                name="clear_eye_catch_image"
                type="hidden"
                value={clearEyeCatchImage ? "1" : "0"}
              />
              <FieldDescription>
                バリアント画像をクリックして差し替えできます。削除を選ぶと画像は未設定になります。
                JPEG/PNG/WebP、10MB以下、2400x3200px以上の画像を選択してください。
              </FieldDescription>
            </FieldContent>
          </Field>

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="flex justify-end">
            <Button disabled={isPending} type="submit">
              {isPending ? "送信中..." : "アイキャッチを更新"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
