"use client";

import { getMessage, parseLocale, toIntlLocale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import { Card, CardContent } from "@publira/ui-components/card";
import { Combobox, MultiCombobox } from "@publira/ui-components/combobox";
import type {
  ComboboxItem,
  MultiComboboxItem,
} from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import { toDateTimeLocalValue } from "@publira/utils";
import Image from "next/image";
import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import type { ChangeEventHandler } from "react";

import { fillInstantFromDateTimeLocal } from "#lib/datetime-local-form";
import { useTenantId } from "#lib/use-tenant-id";

import type { SeriesActionState, SeriesListItem } from "../series-types";

interface CreatorOption {
  publicId: string;
  name: string;
}

interface LabelOption {
  publicId: string;
  name: string;
}

interface SeriesFormProps {
  mode: "create" | "update";
  action: (
    prevState: SeriesActionState,
    formData: FormData
  ) => Promise<SeriesActionState>;
  defaultReadingPeriodHours: number;
  creators: CreatorOption[];
  labels: LabelOption[];
  creatorsErrorMessage?: string;
  labelsErrorMessage?: string;
  initialSeries?: SeriesListItem;
  timeZone: string;
}

const getSubmitLabel = (
  messages: ReturnType<typeof sharedCatalog>,
  mode: "create" | "update",
  isPending: boolean
): string => {
  if (isPending) {
    return getMessage(messages, "admin.series.form.submitting");
  }
  return mode === "update"
    ? getMessage(messages, "admin.series.form.update")
    : getMessage(messages, "admin.series.form.create");
};

interface CreatorFieldProps {
  creatorItems: MultiComboboxItem[];
  creatorsErrorMessage?: string;
  selectedCreatorPublicIds: string[];
  onChange: (nextValue: string[]) => void;
}

const CreatorField = ({
  creatorItems,
  creatorsErrorMessage,
  selectedCreatorPublicIds,
  onChange,
}: CreatorFieldProps) => {
  const messages = sharedCatalog(
    typeof document === "undefined" ? undefined : document.documentElement.lang
  );
  // MultiCombobox renders its own input instead of a Field control, so the
  // label needs an id to point at.
  const comboboxId = useId();

  return (
    <Field>
      <FieldLabel htmlFor={comboboxId}>
        {getMessage(messages, "admin.series.form.creators")}
      </FieldLabel>
      <FieldContent>
        {creatorsErrorMessage ? (
          <FormMessage variant="destructive">
            {creatorsErrorMessage}
          </FormMessage>
        ) : null}

        {creatorItems.length === 0 ? (
          <FieldDescription>
            {getMessage(messages, "admin.series.form.creators_empty")}
          </FieldDescription>
        ) : (
          <MultiCombobox
            id={comboboxId}
            items={creatorItems}
            onValueChange={onChange}
            searchPlaceholder={getMessage(
              messages,
              "admin.series.form.creators_search"
            )}
            value={selectedCreatorPublicIds}
          />
        )}

        {selectedCreatorPublicIds.map((publicId) => (
          <input
            key={publicId}
            name="creator_public_ids"
            type="hidden"
            value={publicId}
          />
        ))}

        <FieldDescription>
          {getMessage(messages, "admin.series.form.creators_description")}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

interface LabelFieldProps {
  labelItems: ComboboxItem[];
  labelsErrorMessage?: string;
  selectedLabelPublicId: string;
  useLabelFallbackInput: boolean;
  onComboboxChange: (nextValue: string) => void;
  onFallbackChange: ChangeEventHandler<HTMLInputElement>;
}

const LabelField = ({
  labelItems,
  labelsErrorMessage,
  selectedLabelPublicId,
  useLabelFallbackInput,
  onComboboxChange,
  onFallbackChange,
}: LabelFieldProps) => {
  const messages = sharedCatalog(
    typeof document === "undefined" ? undefined : document.documentElement.lang
  );
  // Combobox renders its own input instead of a Field control, so the label
  // needs an id to point at. The fallback Input is a Field control and wires
  // itself up.
  const comboboxId = useId();

  return (
    <Field>
      <FieldLabel
        htmlFor={useLabelFallbackInput ? undefined : comboboxId}
        required
      >
        {getMessage(messages, "admin.series.form.label")}
      </FieldLabel>
      <FieldContent>
        {labelsErrorMessage ? (
          <FormMessage variant="destructive">{labelsErrorMessage}</FormMessage>
        ) : null}

        {useLabelFallbackInput ? (
          <>
            <Input
              name="label_public_id"
              onChange={onFallbackChange}
              placeholder={getMessage(
                messages,
                "admin.series.form.label_fallback_placeholder"
              )}
              required
              type="text"
              value={selectedLabelPublicId}
            />
            <FieldDescription>
              {getMessage(
                messages,
                "admin.series.form.label_fallback_description"
              )}
            </FieldDescription>
          </>
        ) : (
          <>
            <Combobox
              emptyMessage={getMessage(
                messages,
                "admin.series.form.label_empty"
              )}
              id={comboboxId}
              items={labelItems}
              onValueChange={onComboboxChange}
              placeholder={getMessage(
                messages,
                "admin.series.form.label_placeholder"
              )}
              value={selectedLabelPublicId}
            />

            <input
              name="label_public_id"
              type="hidden"
              value={selectedLabelPublicId}
            />

            <FieldDescription>
              {getMessage(messages, "admin.series.form.label_description")}
            </FieldDescription>
          </>
        )}
      </FieldContent>
    </Field>
  );
};

interface EyeCatchImageFieldProps {
  clearEyeCatchImage: boolean;
  onImageFileChange: ChangeEventHandler<HTMLInputElement>;
  previewImageUrl: string;
}

const EyeCatchImageField = ({
  clearEyeCatchImage,
  onImageFileChange,
  previewImageUrl,
}: EyeCatchImageFieldProps) => {
  const messages = sharedCatalog(
    typeof document === "undefined" ? undefined : document.documentElement.lang
  );
  const hasPreviewImage = previewImageUrl.length > 0;

  return (
    <Field>
      <FieldLabel>
        {getMessage(messages, "admin.series.form.eye_catch")}
      </FieldLabel>
      <FieldContent>
        <div className="grid gap-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
          <div className="rounded-xl border border-border/60 bg-background p-3">
            <p className="mb-2 text-sm font-medium">
              {getMessage(messages, "admin.series.form.eye_catch_preview")}
            </p>
            <div className="relative aspect-[3/4] max-w-52 overflow-hidden rounded-lg border border-border/60 bg-muted/50">
              {hasPreviewImage ? (
                <Image
                  alt={getMessage(
                    messages,
                    "admin.series.form.eye_catch_preview_alt"
                  )}
                  className="h-full w-full object-cover"
                  fill
                  sizes="(max-width: 768px) 100vw, 240px"
                  src={previewImageUrl}
                  unoptimized
                />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  {getMessage(
                    messages,
                    "admin.series.form.eye_catch_preview_empty"
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <Input
          accept="image/jpeg,image/png,image/webp"
          name="eye_catch_image"
          onChange={onImageFileChange}
          type="file"
        />
        <input
          name="clear_eye_catch_image"
          type="hidden"
          value={clearEyeCatchImage ? "1" : "0"}
        />
        <FieldDescription>
          {getMessage(messages, "admin.series.form.eye_catch_description")}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

const useSeriesFormState = ({
  initialSeries,
}: Pick<SeriesFormProps, "initialSeries">) => {
  const initialCreatorPublicIds = initialSeries?.creatorPublicIds ?? [];
  const initialLabelPublicId = initialSeries?.labelPublicId ?? "";
  const initialCreatorIdsKey = initialCreatorPublicIds.join("\0");
  const [selectedCreatorPublicIds, setSelectedCreatorPublicIds] = useState(
    () => initialCreatorPublicIds
  );
  const [selectedLabelPublicId, setSelectedLabelPublicId] =
    useState(initialLabelPublicId);
  const [prevCreatorIdsKey, setPrevCreatorIdsKey] =
    useState(initialCreatorIdsKey);
  const [prevLabelPublicId, setPrevLabelPublicId] =
    useState(initialLabelPublicId);
  const [uploadedEyeCatchPreviewUrl, setUploadedEyeCatchPreviewUrl] =
    useState("");

  if (initialCreatorIdsKey !== prevCreatorIdsKey) {
    setPrevCreatorIdsKey(initialCreatorIdsKey);
    setSelectedCreatorPublicIds(initialCreatorPublicIds);
  }

  if (initialLabelPublicId !== prevLabelPublicId) {
    setPrevLabelPublicId(initialLabelPublicId);
    setSelectedLabelPublicId(initialLabelPublicId);
  }

  useEffect(
    () => () => {
      if (uploadedEyeCatchPreviewUrl) {
        URL.revokeObjectURL(uploadedEyeCatchPreviewUrl);
      }
    },
    [uploadedEyeCatchPreviewUrl]
  );

  const handleLabelFallbackInputChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >((event) => {
    setSelectedLabelPublicId(event.currentTarget.value);
  }, []);

  const handleEyeCatchImageFileChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >((event) => {
    const file = event.currentTarget.files?.[0];

    setUploadedEyeCatchPreviewUrl((currentValue) => {
      if (currentValue) {
        URL.revokeObjectURL(currentValue);
      }
      return file ? URL.createObjectURL(file) : "";
    });
  }, []);

  let eyeCatchPreviewUrl = "";
  if (uploadedEyeCatchPreviewUrl) {
    eyeCatchPreviewUrl = uploadedEyeCatchPreviewUrl;
  }

  return {
    eyeCatchPreviewUrl,
    handleEyeCatchImageFileChange,
    handleLabelFallbackInputChange,
    selectedCreatorPublicIds,
    selectedLabelPublicId,
    setSelectedCreatorPublicIds,
    setSelectedLabelPublicId,
  };
};

export const SeriesForm = ({
  mode,
  action,
  defaultReadingPeriodHours,
  creators,
  labels,
  creatorsErrorMessage,
  labelsErrorMessage,
  initialSeries,
  timeZone,
}: SeriesFormProps) => {
  const messages = sharedCatalog(
    typeof document === "undefined" ? undefined : document.documentElement.lang
  );
  const locale = parseLocale(
    typeof document === "undefined" ? undefined : document.documentElement.lang
  );
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const creatorItems = useMemo<MultiComboboxItem[]>(
    () =>
      creators
        .map((creator) => ({
          label: creator.name,
          value: creator.publicId,
        }))
        .toSorted((a, b) =>
          a.label.localeCompare(b.label, toIntlLocale(locale))
        ),
    [creators, locale]
  );
  const labelItems = useMemo<ComboboxItem[]>(
    () =>
      labels
        .map((label) => ({
          label: label.name,
          value: label.publicId,
        }))
        .toSorted((a, b) =>
          a.label.localeCompare(b.label, toIntlLocale(locale))
        ),
    [labels, locale]
  );
  const {
    eyeCatchPreviewUrl,
    handleEyeCatchImageFileChange,
    handleLabelFallbackInputChange,
    selectedCreatorPublicIds,
    selectedLabelPublicId,
    setSelectedCreatorPublicIds,
    setSelectedLabelPublicId,
  } = useSeriesFormState({ initialSeries });

  const useLabelFallbackInput =
    Boolean(labelsErrorMessage) || labelItems.length === 0;

  const isUpdate = mode === "update";
  const submitLabel = getSubmitLabel(messages, mode, isPending);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      fillInstantFromDateTimeLocal(event.currentTarget, {
        isoName: "published_at",
        localName: "published_at_local",
        timeZone,
      });
    },
    [timeZone]
  );

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          action={formAction}
          className="grid gap-4"
          onSubmit={handleSubmit}
        >
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input
            name="public_id"
            type="hidden"
            value={initialSeries?.publicId ?? ""}
          />

          <div className="grid gap-4">
            <Field>
              <FieldLabel required>
                {getMessage(messages, "admin.series.form.title")}
              </FieldLabel>
              <FieldContent>
                <Input
                  defaultValue={initialSeries?.title ?? ""}
                  name="title"
                  placeholder={getMessage(
                    messages,
                    "admin.series.form.title_placeholder"
                  )}
                  required
                  type="text"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel required>
                {getMessage(messages, "admin.series.form.reading_period")}
              </FieldLabel>
              <FieldContent>
                <Input
                  defaultValue={
                    initialSeries?.readingPeriodHours ??
                    defaultReadingPeriodHours
                  }
                  min={0}
                  name="reading_period_hours"
                  required
                  type="number"
                />
                <FieldDescription>
                  {getMessage(
                    messages,
                    "admin.series.form.reading_period_description"
                  )}
                </FieldDescription>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel required>
                {getMessage(messages, "admin.series.form.synopsis")}
              </FieldLabel>
              <FieldContent>
                <Textarea
                  defaultValue={initialSeries?.synopsis ?? ""}
                  name="synopsis"
                  placeholder={getMessage(
                    messages,
                    "admin.series.form.synopsis_placeholder"
                  )}
                  required
                  rows={5}
                />
              </FieldContent>
            </Field>

            <CreatorField
              creatorItems={creatorItems}
              creatorsErrorMessage={creatorsErrorMessage}
              onChange={setSelectedCreatorPublicIds}
              selectedCreatorPublicIds={selectedCreatorPublicIds}
            />

            <LabelField
              labelItems={labelItems}
              labelsErrorMessage={labelsErrorMessage}
              onComboboxChange={setSelectedLabelPublicId}
              onFallbackChange={handleLabelFallbackInputChange}
              selectedLabelPublicId={selectedLabelPublicId}
              useLabelFallbackInput={useLabelFallbackInput}
            />

            <Field>
              <FieldLabel>
                {getMessage(messages, "admin.series.form.published_at")}
              </FieldLabel>
              <FieldContent>
                <input defaultValue="" name="published_at" type="hidden" />
                <Input
                  // Wall clock shown in the zone this form was rendered in.
                  // Submit writes the matching instant into `published_at`.
                  defaultValue={toDateTimeLocalValue(
                    initialSeries?.publishedAt ?? "",
                    timeZone
                  )}
                  name="published_at_local"
                  type="datetime-local"
                />
                <FieldDescription>
                  {getMessage(
                    messages,
                    "admin.series.form.published_at_description",
                    {
                      time_zone: timeZone,
                    }
                  )}
                </FieldDescription>
              </FieldContent>
            </Field>
          </div>

          {!isUpdate && (
            <EyeCatchImageField
              clearEyeCatchImage={false}
              onImageFileChange={handleEyeCatchImageFileChange}
              previewImageUrl={eyeCatchPreviewUrl}
            />
          )}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="flex justify-end">
            <Button disabled={isPending} type="submit">
              {submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
