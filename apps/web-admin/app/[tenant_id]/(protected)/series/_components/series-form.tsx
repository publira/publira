"use client";

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
  useMemo,
  useState,
} from "react";
import type { ChangeEventHandler } from "react";

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
  mode: "create" | "update",
  isPending: boolean
): string => {
  if (isPending) {
    return "送信中...";
  }
  return mode === "update" ? "シリーズを更新" : "シリーズを作成";
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
}: CreatorFieldProps) => (
  <Field>
    <FieldLabel htmlFor="series_creator_combobox">クリエイター</FieldLabel>
    <FieldContent>
      {creatorsErrorMessage ? (
        <FormMessage variant="destructive">{creatorsErrorMessage}</FormMessage>
      ) : null}

      {creatorItems.length === 0 ? (
        <FieldDescription>
          選択可能なクリエイターがいません。先にクリエイターを作成してください。
        </FieldDescription>
      ) : (
        <MultiCombobox
          id="series_creator_combobox"
          items={creatorItems}
          onValueChange={onChange}
          searchPlaceholder="クリエイター名で検索"
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
        複数選択できます。シリーズに紐づけるクリエイターを選んでください。
      </FieldDescription>
    </FieldContent>
  </Field>
);

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
}: LabelFieldProps) => (
  <Field>
    <FieldLabel htmlFor="series_label_combobox" required>
      レーベル
    </FieldLabel>
    <FieldContent>
      {labelsErrorMessage ? (
        <FormMessage variant="destructive">{labelsErrorMessage}</FormMessage>
      ) : null}

      {useLabelFallbackInput ? (
        <>
          <Input
            id="series_label_public_id"
            name="label_public_id"
            onChange={onFallbackChange}
            placeholder="例: label_demo"
            required
            type="text"
            value={selectedLabelPublicId}
          />
          <FieldDescription>
            レーベル一覧を取得できないため、公開 ID を直接入力してください。
          </FieldDescription>
        </>
      ) : (
        <>
          <Combobox
            emptyMessage="一致するレーベルが見つかりません。"
            id="series_label_combobox"
            items={labelItems}
            onValueChange={onComboboxChange}
            placeholder="レーベル名で検索"
            value={selectedLabelPublicId}
          />

          <input
            name="label_public_id"
            type="hidden"
            value={selectedLabelPublicId}
          />

          <FieldDescription>
            シリーズに紐づけるレーベルを選択してください。
          </FieldDescription>
        </>
      )}
    </FieldContent>
  </Field>
);

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
  const hasPreviewImage = previewImageUrl.length > 0;

  return (
    <Field>
      <FieldLabel htmlFor="series_eye_catch_image">アイキャッチ画像</FieldLabel>
      <FieldContent>
        <div className="grid gap-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
          <div className="rounded-xl border border-border/60 bg-background p-3">
            <p className="mb-2 text-sm font-medium">アップロード前プレビュー</p>
            <div className="relative aspect-[3/4] max-w-52 overflow-hidden rounded-lg border border-border/60 bg-muted/50">
              {hasPreviewImage ? (
                <Image
                  alt="アップロード画像プレビュー"
                  className="h-full w-full object-cover"
                  fill
                  sizes="(max-width: 768px) 100vw, 240px"
                  src={previewImageUrl}
                  unoptimized
                />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  新しい画像を選択するとここに表示されます。
                </div>
              )}
            </div>
          </div>
        </div>

        <Input
          accept="image/jpeg,image/png,image/webp"
          id="series_eye_catch_image"
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
          JPEG/PNG/WebP、10MB以下、2400x3200px以上の画像を選択してください。
          保存時に用途別バリアント (3:4 / 1:1 / 16:9 / OG)
          と端末向けサイズが生成されます。
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
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const creatorItems = useMemo<MultiComboboxItem[]>(
    () =>
      creators
        .map((creator) => ({
          label: creator.name,
          value: creator.publicId,
        }))
        .toSorted((a, b) => a.label.localeCompare(b.label, "ja")),
    [creators]
  );
  const labelItems = useMemo<ComboboxItem[]>(
    () =>
      labels
        .map((label) => ({
          label: label.name,
          value: label.publicId,
        }))
        .toSorted((a, b) => a.label.localeCompare(b.label, "ja")),
    [labels]
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
  const submitLabel = getSubmitLabel(mode, isPending);

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input
            name="public_id"
            type="hidden"
            value={initialSeries?.publicId ?? ""}
          />

          <div className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="series_title" required>
                タイトル
              </FieldLabel>
              <FieldContent>
                <Input
                  defaultValue={initialSeries?.title ?? ""}
                  id="series_title"
                  name="title"
                  placeholder="例: 海風と活版印刷"
                  required
                  type="text"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="series_reading_period_hours" required>
                閲覧可能期間
              </FieldLabel>
              <FieldContent>
                <Input
                  defaultValue={
                    initialSeries?.readingPeriodHours ??
                    defaultReadingPeriodHours
                  }
                  id="series_reading_period_hours"
                  min={0}
                  name="reading_period_hours"
                  required
                  type="number"
                />
                <FieldDescription>
                  単位は時間です。0 を指定すると無制限で閲覧できます。
                </FieldDescription>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="series_synopsis" required>
                概要
              </FieldLabel>
              <FieldContent>
                <Textarea
                  defaultValue={initialSeries?.synopsis ?? ""}
                  id="series_synopsis"
                  name="synopsis"
                  placeholder="シリーズの紹介文を入力"
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
              <FieldLabel htmlFor="series_published_at">公開日時</FieldLabel>
              <FieldContent>
                <Input
                  // Wall clock shown in the admin display zone; the action
                  // resolves it back against the same zone on submit.
                  defaultValue={toDateTimeLocalValue(
                    initialSeries?.publishedAt ?? "",
                    timeZone
                  )}
                  id="series_published_at"
                  name="published_at"
                  type="datetime-local"
                />
                <FieldDescription>
                  空欄の場合は非公開です。日時はテナントのタイムゾーン（
                  {timeZone}
                  ）の壁時計として解釈し、その時刻以降に公開されます。
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
