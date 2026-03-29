"use client";

import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
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
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ChangeEventHandler } from "react";

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
  tenantPublicId: string;
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

export const SeriesForm = ({
  mode,
  tenantPublicId,
  action,
  defaultReadingPeriodHours,
  creators,
  labels,
  creatorsErrorMessage,
  labelsErrorMessage,
  initialSeries,
}: SeriesFormProps) => {
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
  const [selectedCreatorPublicIds, setSelectedCreatorPublicIds] = useState<
    string[]
  >([]);
  const [selectedLabelPublicId, setSelectedLabelPublicId] = useState("");

  useEffect(() => {
    setSelectedCreatorPublicIds(initialSeries?.creatorPublicIds ?? []);
  }, [initialSeries?.creatorPublicIds, mode]);

  useEffect(() => {
    setSelectedLabelPublicId(initialSeries?.labelPublicId ?? "");
  }, [initialSeries?.labelPublicId, mode]);

  const handleLabelFallbackInputChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >((event) => {
    setSelectedLabelPublicId(event.currentTarget.value);
  }, []);

  const useLabelFallbackInput =
    Boolean(labelsErrorMessage) || labelItems.length === 0;

  const isUpdate = mode === "update";
  const submitLabel = getSubmitLabel(mode, isPending);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isUpdate ? "シリーズ情報" : "新規シリーズ"}</CardTitle>
        <CardDescription>
          {isUpdate
            ? "タイトル・概要・公開設定などを編集します。"
            : "シリーズの基本情報を入力してください。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_public_id" type="hidden" value={tenantPublicId} />
          <input
            name="public_id"
            type="hidden"
            value={initialSeries?.publicId ?? ""}
          />

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
                  initialSeries?.readingPeriodHours ?? defaultReadingPeriodHours
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

          <label className="flex items-center gap-2 text-sm">
            <input
              className="h-4 w-4 rounded border-input"
              defaultChecked={initialSeries?.isPublished ?? false}
              name="is_published"
              type="checkbox"
            />
            公開する
          </label>

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
