"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
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
import { useActionState, useCallback, useState } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import type { CreatorActionState, CreatorListItem } from "../creator-types";

interface CreatorFormProps {
  mode: "create" | "update";
  action: (
    prevState: CreatorActionState,
    formData: FormData
  ) => Promise<CreatorActionState>;
  initialCreator?: CreatorListItem;
}

interface IconImageFieldProps {
  clearIconImage: boolean;
  initialCreator?: CreatorListItem;
  isUpdate: boolean;
  onClearIconImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const IconImageField = ({
  clearIconImage,
  initialCreator,
  isUpdate,
  onClearIconImageChange,
}: IconImageFieldProps) => {
  const messages = sharedCatalog(
    typeof document === "undefined" ? undefined : document.documentElement.lang
  );
  const iconImageUrl = initialCreator?.iconImageUrl ?? "";
  const hasExistingIconImage = iconImageUrl.length > 0;

  return (
    <Field>
      <FieldLabel>
        {getMessage(messages, "admin.creators.form.icon")}
      </FieldLabel>
      <FieldContent>
        {hasExistingIconImage && !clearIconImage ? (
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
          type="file"
        />
        {isUpdate && hasExistingIconImage ? (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              checked={clearIconImage}
              onChange={onClearIconImageChange}
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
    </Field>
  );
};

export const CreatorForm = ({
  mode,
  action,
  initialCreator,
}: CreatorFormProps) => {
  const messages = sharedCatalog(
    typeof document === "undefined" ? undefined : document.documentElement.lang
  );
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const initialName = initialCreator?.name ?? "";
  const initialProfileText = initialCreator?.profileText ?? "";
  const [name, setName] = useState(initialName);
  const [profileText, setProfileText] = useState(initialProfileText);
  const [clearIconImage, setClearIconImage] = useState(false);
  const [prevInitialName, setPrevInitialName] = useState(initialName);
  const [prevInitialProfileText, setPrevInitialProfileText] =
    useState(initialProfileText);
  const [prevMode, setPrevMode] = useState(mode);

  if (
    initialName !== prevInitialName ||
    initialProfileText !== prevInitialProfileText ||
    mode !== prevMode
  ) {
    setPrevInitialName(initialName);
    setPrevInitialProfileText(initialProfileText);
    setPrevMode(mode);
    setName(initialName);
    setProfileText(initialProfileText);
    setClearIconImage(false);
  }

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

  const handleClearIconImageChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setClearIconImage(event.target.checked);
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
    <Card>
      <CardHeader>
        <CardTitle>
          {isUpdate
            ? getMessage(messages, "admin.creators.form.update_card_title")
            : getMessage(messages, "admin.creators.form.create_card_title")}
        </CardTitle>
        <CardDescription>
          {isUpdate
            ? getMessage(messages, "admin.creators.form.update_description")
            : getMessage(messages, "admin.creators.form.create_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                {getMessage(
                  messages,
                  "admin.creators.form.profile_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          <IconImageField
            clearIconImage={clearIconImage}
            initialCreator={initialCreator}
            isUpdate={isUpdate}
            onClearIconImageChange={handleClearIconImageChange}
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
      </CardContent>
    </Card>
  );
};
