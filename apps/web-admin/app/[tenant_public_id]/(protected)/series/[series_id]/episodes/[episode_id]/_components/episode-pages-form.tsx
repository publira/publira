"use client";

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
import { useActionState, useEffectEvent, useRef, useState } from "react";

import type { EpisodeEditActionState } from "../episode-edit-types";

interface EpisodePagesFormProps {
  tenantPublicId: string;
  seriesPublicId: string;
  episodePublicId: string;
  action: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
}

export const EpisodePagesForm = ({
  tenantPublicId,
  seriesPublicId,
  episodePublicId,
  action,
}: EpisodePagesFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);
  const [uploadMode, setUploadMode] = useState<"pages" | "zip" | "epub">(
    "pages"
  );
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateFiles = (files: FileList | null) => {
    setSelectedFileNames(files ? [...files].map((file) => file.name) : []);
  };

  const handleDragEnter = useEffectEvent(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(true);
    }
  );

  const handleDragLeave = useEffectEvent(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
    }
  );

  const handleDragOver = useEffectEvent(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(true);
    }
  );

  const handleDrop = useEffectEvent(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      const { files } = event.dataTransfer;
      if (!inputRef.current || files.length === 0) {
        return;
      }

      const droppedFiles =
        uploadMode === "pages" ? [...files] : [files[0]].filter(Boolean);

      const dataTransfer = new DataTransfer();
      for (const file of droppedFiles) {
        dataTransfer.items.add(file);
      }
      inputRef.current.files = dataTransfer.files;
      updateFiles(dataTransfer.files);
    }
  );

  const handleChange = useEffectEvent(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updateFiles(event.currentTarget.files);
    }
  );

  const handleSelectPages = useEffectEvent(() => {
    setUploadMode("pages");
    setSelectedFileNames([]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  });

  const handleSelectZip = useEffectEvent(() => {
    setUploadMode("zip");
    setSelectedFileNames([]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  });

  const handleSelectEpub = useEffectEvent(() => {
    setUploadMode("epub");
    setSelectedFileNames([]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  });

  let fileLabel = "ページ画像";
  let dropMessage = "ここに画像をドロップするか、ファイルを選択してください。";
  let acceptValue = "image/*";
  let fieldDescription = "追加時の表示順は既存の末尾に続けて自動採番されます。";

  if (uploadMode === "zip") {
    fileLabel = "ZIP ファイル";
    dropMessage = "ここに ZIP をドロップするか、ファイルを選択してください。";
    acceptValue = ".zip,application/zip";
    fieldDescription =
      "ZIP 内の画像を展開して登録します。壊れた ZIP や不正パスを含む ZIP は拒否されます。";
  }

  if (uploadMode === "epub") {
    fileLabel = "ePub ファイル";
    dropMessage = "ここに ePub をドロップするか、ファイルを選択してください。";
    acceptValue = ".epub,application/epub+zip";
    fieldDescription =
      "ePub（.epub）から本文画像を抽出して登録します。壊れた ePub や参照不整合・不正パスを含むファイルは拒否されます。";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>漫画ページ追加</CardTitle>
        <CardDescription>
          エピソードに紐づくページ画像を複数選択して追加します。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_public_id" type="hidden" value={tenantPublicId} />
          <input name="series_public_id" type="hidden" value={seriesPublicId} />
          <input
            name="episode_public_id"
            type="hidden"
            value={episodePublicId}
          />
          <input name="upload_mode" type="hidden" value={uploadMode} />

          <Field>
            <FieldLabel>入稿対象</FieldLabel>
            <FieldContent>
              <p className="text-sm text-muted-foreground">
                Series: {seriesPublicId} / Episode: {episodePublicId}
              </p>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>アップロード方法</FieldLabel>
            <FieldContent>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={isPending}
                  onClick={handleSelectPages}
                  type="button"
                  variant={uploadMode === "pages" ? "default" : "outline"}
                >
                  ページ画像を複数選択
                </Button>
                <Button
                  disabled={isPending}
                  onClick={handleSelectZip}
                  type="button"
                  variant={uploadMode === "zip" ? "default" : "outline"}
                >
                  ZIP で入稿
                </Button>
                <Button
                  disabled={isPending}
                  onClick={handleSelectEpub}
                  type="button"
                  variant={uploadMode === "epub" ? "default" : "outline"}
                >
                  ePub で入稿
                </Button>
              </div>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="episode_pages" required>
              {fileLabel}
            </FieldLabel>
            <FieldContent>
              <div
                className={
                  isDragOver
                    ? "rounded-lg border-2 border-dashed border-foreground/60 bg-muted/50 p-4"
                    : "rounded-lg border-2 border-dashed border-border p-4"
                }
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <p className="mb-3 text-sm text-muted-foreground">
                  {dropMessage}
                </p>
                <Input
                  accept={acceptValue}
                  id="episode_pages"
                  multiple={uploadMode === "pages"}
                  name={uploadMode === "pages" ? "pages" : "archive"}
                  onChange={handleChange}
                  ref={inputRef}
                  required
                  type="file"
                />
              </div>
              <FieldDescription>{fieldDescription}</FieldDescription>
              {selectedFileNames.length > 0 ? (
                <div className="grid gap-1 text-xs text-muted-foreground">
                  {selectedFileNames.map((fileName) => (
                    <p key={fileName}>{fileName}</p>
                  ))}
                </div>
              ) : null}
              {isPending ? (
                <div className="grid gap-2">
                  <progress aria-label="アップロード進捗" className="w-full" />
                  <p className="text-xs text-muted-foreground">
                    ファイルを処理しています。完了までしばらくお待ちください。
                  </p>
                </div>
              ) : null}
            </FieldContent>
          </Field>

          {state && state.mode === "pages" ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={isPending} type="submit">
              {(() => {
                if (isPending) {
                  return "追加中...";
                }
                if (uploadMode === "zip") {
                  return "ZIP を入稿";
                }
                if (uploadMode === "epub") {
                  return "ePub を入稿";
                }
                return "ページ画像を追加";
              })()}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
