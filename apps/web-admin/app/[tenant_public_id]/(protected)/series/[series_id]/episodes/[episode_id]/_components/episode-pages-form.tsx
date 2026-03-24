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
      const dataTransfer = new DataTransfer();
      for (const file of files) {
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

          <Field>
            <FieldLabel htmlFor="episode_pages" required>
              ページ画像
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
                  ここに画像をドロップするか、ファイルを選択してください。
                </p>
                <Input
                  accept="image/*"
                  id="episode_pages"
                  multiple
                  name="pages"
                  onChange={handleChange}
                  ref={inputRef}
                  required
                  type="file"
                />
              </div>
              <FieldDescription>
                追加時の表示順は既存の末尾に続けて自動採番されます。
              </FieldDescription>
              {selectedFileNames.length > 0 ? (
                <div className="grid gap-1 text-xs text-muted-foreground">
                  {selectedFileNames.map((fileName) => (
                    <p key={fileName}>{fileName}</p>
                  ))}
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
              {isPending ? "追加中..." : "ページ画像を追加"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
