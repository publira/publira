"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import Image from "next/image";
import type { ChangeEventHandler, ReactEventHandler } from "react";
import {
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import type { CropAspect, CropSource } from "#components/image-crop/crop";
import {
  centreCropRect,
  framedPreviewStyle,
} from "#components/image-crop/crop";
import { ImageCropDialog } from "#components/image-crop/crop-dialog";
import type { CropRect } from "#lib/crop-rect";
import { CROP_RECT_FIELD, formatCropRect } from "#lib/crop-rect";
import { useTenantId } from "#lib/use-tenant-id";

import type { CreatorActionState, CreatorListItem } from "../creator-types";

/**
 * An author icon is one square, cut out of whatever was uploaded for it. The
 * minimum is the API's own (`creatorIconMinDimension`), so a frame this control
 * allows is a frame the upload will be accepted with.
 */
const ICON_ASPECT: CropAspect = {
  aspectHeight: 1,
  aspectWidth: 1,
  minWidth: 256,
};

interface IconImageFieldProps {
  initialCreator?: CreatorListItem;
  isUpdate: boolean;
}

const IconImageField = ({ initialCreator, isUpdate }: IconImageFieldProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const iconImageUrl = initialCreator?.iconImageUrl ?? "";
  const hasExistingIconImage = iconImageUrl.length > 0;

  const [clearIconImage, setClearIconImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  /** The picked file's own size, and the part of it the editor framed. */
  const [source, setSource] = useState<CropSource | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [isFraming, setIsFraming] = useState(false);

  useEffect(
    () => () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    },
    [localPreviewUrl]
  );

  const handleClearIconImageChange: ChangeEventHandler<HTMLInputElement> = (
    event
  ) => {
    setClearIconImage(event.target.checked);
  };

  const handleImageFileChange: ChangeEventHandler<HTMLInputElement> = (
    event
  ) => {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }
    setLocalPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return URL.createObjectURL(file);
    });
    // Both belong to the file that was just replaced. The new one reports its
    // own size when it is decoded, and the frame is derived from that.
    setSource(null);
    setCrop(null);
    setIsFraming(true);
  };

  /**
   * The frame starts where the API would have cut on its own, so an editor who
   * touches nothing gets the icon this form has always produced. A file whose
   * frame is already set keeps it: the dialog remounts its image every time it
   * is opened, and this runs again each time.
   */
  const handleCropImageLoad: ReactEventHandler<HTMLImageElement> = (event) => {
    const size = {
      height: event.currentTarget.naturalHeight,
      width: event.currentTarget.naturalWidth,
    };
    setSource(size);
    setCrop((current) => current ?? centreCropRect(size, ICON_ASPECT));
  };

  const framedStyle = crop && source ? framedPreviewStyle(crop, source) : null;

  return (
    <Field>
      <FieldLabel>
        {getMessage(messages, "admin.creators.form.icon")}
      </FieldLabel>
      <FieldContent>
        {localPreviewUrl ? (
          <div className="relative size-20 overflow-hidden rounded-full border">
            {/* The picked file is a blob of unknown size, so next/image cannot
                carry it. */}
            {/* oxlint-disable-next-line next/no-img-element, react-doctor/nextjs-no-img-element */}
            <img
              alt={getMessage(messages, "admin.creators.form.icon_preview_alt")}
              className={
                framedStyle
                  ? "absolute max-w-none"
                  : "h-full w-full object-cover"
              }
              src={localPreviewUrl}
              style={framedStyle ?? undefined}
            />
          </div>
        ) : null}
        {hasExistingIconImage && !(clearIconImage || localPreviewUrl) ? (
          <Image
            alt={getMessage(messages, "admin.creators.form.current_icon_alt")}
            className="size-20 rounded-full border object-cover"
            height={80}
            src={iconImageUrl}
            width={80}
          />
        ) : null}
        <Input
          accept="image/jpeg,image/png,image/webp"
          name="icon_image"
          onChange={handleImageFileChange}
          type="file"
        />
        {localPreviewUrl ? (
          <Button
            className="mt-2 w-fit"
            onClick={() => setIsFraming(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            {getMessage(messages, "admin.image_crop.adjust")}
          </Button>
        ) : null}
        {crop ? (
          <input
            name={CROP_RECT_FIELD}
            type="hidden"
            value={formatCropRect(crop)}
          />
        ) : null}
        {isUpdate && hasExistingIconImage ? (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              checked={clearIconImage}
              onChange={handleClearIconImageChange}
              type="checkbox"
            />
            {getMessage(messages, "admin.creators.form.clear_icon")}
          </label>
        ) : null}
        <input
          name="clear_icon_image"
          type="hidden"
          value={clearIconImage ? "1" : "0"}
        />
        <FieldDescription>
          {getMessage(messages, "admin.creators.form.icon_description")}
        </FieldDescription>
      </FieldContent>

      {localPreviewUrl ? (
        <ImageCropDialog
          aspect={ICON_ASPECT}
          crop={crop}
          imageUrl={localPreviewUrl}
          onCropChange={setCrop}
          onImageLoad={handleCropImageLoad}
          onOpenChange={setIsFraming}
          open={isFraming}
          source={source}
          title={getMessage(messages, "admin.creators.form.icon_crop_title")}
        />
      ) : null}
    </Field>
  );
};

interface CreatorFormProps {
  mode: "create" | "update";
  action: (
    prevState: CreatorActionState,
    formData: FormData
  ) => Promise<CreatorActionState>;
  initialCreator?: CreatorListItem;
}

export const CreatorForm = ({
  mode,
  action,
  initialCreator,
}: CreatorFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  // Seeded once per mount: the edit route keys this form by the creator's
  // public id, so switching to another creator remounts it with that creator's
  // values.
  const [name, setName] = useState(initialCreator?.name ?? "");
  const [profileText, setProfileText] = useState(
    initialCreator?.profileText ?? ""
  );

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setName(event.target.value);
    },
    []
  );

  const handleProfileTextChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setProfileText(event.target.value);
    },
    []
  );

  const isUpdate = mode === "update";
  let submitLabel = getMessage(messages, "admin.creators.form.create");
  if (isUpdate) {
    submitLabel = getMessage(messages, "admin.creators.form.update");
  }
  if (isPending) {
    submitLabel = getMessage(messages, "admin.creators.form.submitting");
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input
        name="public_id"
        type="hidden"
        value={initialCreator?.publicId ?? ""}
      />

      <Field>
        <FieldLabel required>
          {getMessage(messages, "admin.creators.form.name")}
        </FieldLabel>
        <FieldContent>
          <Input
            name="name"
            onChange={handleNameChange}
            placeholder={getMessage(
              messages,
              "admin.creators.form.name_placeholder"
            )}
            required
            type="text"
            value={name}
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel>
          {getMessage(messages, "admin.creators.form.profile")}
        </FieldLabel>
        <FieldContent>
          <Textarea
            name="profile_text"
            onChange={handleProfileTextChange}
            placeholder={getMessage(
              messages,
              "admin.creators.form.profile_placeholder"
            )}
            rows={5}
            value={profileText}
          />
          <FieldDescription>
            {getMessage(messages, "admin.creators.form.profile_description")}
          </FieldDescription>
        </FieldContent>
      </Field>

      {/*
        The saved icon's timestamp keys the field, so a save that replaced
        or removed the icon remounts it: the picked file, its frame, and the
        deletion checkbox all belong to that save and none of them mean
        anything afterwards.
      */}
      <IconImageField
        initialCreator={initialCreator}
        isUpdate={isUpdate}
        key={initialCreator?.iconImageUpdatedAt ?? ""}
      />

      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <Button disabled={isPending} type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
};
