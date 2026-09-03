"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import { Card, CardContent } from "@publira/ui-components/card";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { cn } from "@publira/utils";
import { useRouter } from "next/navigation";
import type { ChangeEventHandler } from "react";
import {
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { useTenantId } from "#lib/use-tenant-id";

import { EYE_CATCH_ASPECTS, eyeCatchAspectClassName } from "./aspects";
import type { EyeCatchAspectActionState, EyeCatchVariantItem } from "./types";

type EyeCatchAspectAction = (
  prevState: EyeCatchAspectActionState,
  formData: FormData
) => Promise<EyeCatchAspectActionState>;

interface EyeCatchAspectImagesProps {
  /** The series or label the ratios belong to. */
  publicId: string;
  /** The images the eye-catch currently holds, across every ratio. */
  variants: EyeCatchVariantItem[];
  uploadAction: EyeCatchAspectAction;
}

interface EyeCatchAspectSlotProps extends EyeCatchAspectImagesProps {
  variantType: string;
  minWidth: number;
  minHeight: number;
}

const largestVariant = (
  variants: EyeCatchVariantItem[],
  variantType: string
): EyeCatchVariantItem | undefined =>
  variants
    .filter((variant) => variant.variantType === variantType)
    .toSorted((a, b) => a.width - b.width)
    .at(-1);

const EyeCatchAspectSlot = ({
  minHeight,
  minWidth,
  publicId,
  uploadAction,
  variants,
  variantType,
}: EyeCatchAspectSlotProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const router = useRouter();

  const [state, formAction, isUploading] = useActionState(uploadAction, null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handlePickImage = useCallback(() => {
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
    }
  }, []);

  const current = largestVariant(variants, variantType);
  const previewUrl = localPreviewUrl || current?.url || "";

  return (
    <div className="grid gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{variantType}</p>
        {current ? (
          <p className="text-xs text-muted-foreground">
            {current.width}&times;{current.height}
          </p>
        ) : null}
      </div>

      <button
        aria-label={getMessage(messages, "admin.eye_catch.aspect.select_aria", {
          variant_type: variantType,
        })}
        className={cn(
          "relative overflow-hidden rounded-md border border-border/50 bg-muted/40 transition-colors hover:border-blue-300",
          eyeCatchAspectClassName(variantType)
        )}
        onClick={handlePickImage}
        type="button"
      >
        {previewUrl ? (
          // Each ratio is its own URL, and the picked file is a blob; next/image
          // cannot carry both behind one src.
          // oxlint-disable-next-line next/no-img-element, react-doctor/nextjs-no-img-element
          <img
            alt={getMessage(messages, "admin.eye_catch.variant_alt", {
              variant_type: variantType,
            })}
            className="h-full w-full object-cover"
            src={previewUrl}
          />
        ) : (
          <span className="flex h-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
            {getMessage(messages, "admin.eye_catch.aspect.empty")}
          </span>
        )}
      </button>

      <p className="text-xs text-muted-foreground">
        {getMessage(messages, "admin.eye_catch.aspect.minimum", {
          height: String(minHeight),
          width: String(minWidth),
        })}
      </p>

      <form action={formAction} className="grid gap-2">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="public_id" type="hidden" value={publicId} />
        <input name="variant_type" type="hidden" value={variantType} />
        <Input
          accept="image/jpeg,image/png,image/webp"
          name="aspect_image"
          onChange={handleImageFileChange}
          ref={fileInputRef}
          style={{ display: "none" }}
          type="file"
        />
        <Button
          disabled={isUploading || localPreviewUrl.length === 0}
          size="sm"
          type="submit"
        >
          {getMessage(
            messages,
            isUploading
              ? "admin.eye_catch.aspect.uploading"
              : "admin.eye_catch.aspect.upload"
          )}
        </Button>
      </form>

      {state && state.variantType === variantType ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}
    </div>
  );
};

/**
 * The per-ratio images of an eye-catch.
 *
 * Each ratio holds its own image and they are independent: replacing one here
 * leaves the other three exactly as they were. Uploading a whole eye-catch
 * above fills all four at once.
 */
export const EyeCatchAspectImages = ({
  publicId,
  uploadAction,
  variants,
}: EyeCatchAspectImagesProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="grid gap-1">
          <h2 className="text-sm font-medium">
            {getMessage(messages, "admin.eye_catch.aspect.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {getMessage(messages, "admin.eye_catch.aspect.description")}
          </p>
        </div>
        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {getMessage(messages, "admin.eye_catch.aspect.eye_catch_required")}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {EYE_CATCH_ASPECTS.map((aspect) => (
              <EyeCatchAspectSlot
                key={aspect.variantType}
                minHeight={aspect.minHeight}
                minWidth={aspect.minWidth}
                publicId={publicId}
                uploadAction={uploadAction}
                variants={variants}
                variantType={aspect.variantType}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
