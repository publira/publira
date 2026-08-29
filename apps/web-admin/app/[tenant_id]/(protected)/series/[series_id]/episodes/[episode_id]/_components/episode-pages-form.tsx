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
import { useActionState, useCallback, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import type { EpisodeEditActionState } from "../episode-edit-types";

interface EpisodePagesFormProps {
  seriesPublicId: string;
  episodePublicId: string;
  action: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
}

export const EpisodePagesForm = ({
  seriesPublicId,
  episodePublicId,
  action,
}: EpisodePagesFormProps) => {
  const messages = sharedCatalog(document.documentElement.lang);
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [uploadMode, setUploadMode] = useState<"pages" | "zip" | "epub">(
    "pages"
  );
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateFiles = useCallback((files: FileList | null) => {
    setSelectedFileNames(files ? [...files].map((file) => file.name) : []);
  }, []);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
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
    },
    [updateFiles, uploadMode]
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      updateFiles(event.currentTarget.files);
    },
    [updateFiles]
  );

  const handleSelectPages = useCallback(() => {
    setUploadMode("pages");
    setSelectedFileNames([]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  const handleSelectZip = useCallback(() => {
    setUploadMode("zip");
    setSelectedFileNames([]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  const handleSelectEpub = useCallback(() => {
    setUploadMode("epub");
    setSelectedFileNames([]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  let fileLabel = getMessage(messages, "admin.series.episodes.pages.image");
  let dropMessage = getMessage(
    messages,
    "admin.series.episodes.pages.drop_image"
  );
  let acceptValue = "image/*";
  let fieldDescription = getMessage(
    messages,
    "admin.series.episodes.pages.image_description"
  );

  if (uploadMode === "zip") {
    fileLabel = getMessage(messages, "admin.series.episodes.pages.zip");
    dropMessage = getMessage(messages, "admin.series.episodes.pages.drop_zip");
    acceptValue = ".zip,application/zip";
    fieldDescription = getMessage(
      messages,
      "admin.series.episodes.pages.zip_description"
    );
  }

  if (uploadMode === "epub") {
    fileLabel = getMessage(messages, "admin.series.episodes.pages.epub");
    dropMessage = getMessage(messages, "admin.series.episodes.pages.drop_epub");
    acceptValue = ".epub,application/epub+zip";
    fieldDescription = getMessage(
      messages,
      "admin.series.episodes.pages.epub_description"
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.series.episodes.pages.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.series.episodes.pages.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="series_public_id" type="hidden" value={seriesPublicId} />
          <input
            name="episode_public_id"
            type="hidden"
            value={episodePublicId}
          />
          <input name="upload_mode" type="hidden" value={uploadMode} />

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.series.episodes.pages.target")}
            </FieldLabel>
            <FieldContent>
              <p className="text-sm text-muted-foreground">
                Series: {seriesPublicId} / Episode: {episodePublicId}
              </p>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.series.episodes.pages.method")}
            </FieldLabel>
            <FieldContent>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={isPending}
                  onClick={handleSelectPages}
                  type="button"
                  variant={uploadMode === "pages" ? "default" : "outline"}
                >
                  {getMessage(
                    messages,
                    "admin.series.episodes.pages.select_images"
                  )}
                </Button>
                <Button
                  disabled={isPending}
                  onClick={handleSelectZip}
                  type="button"
                  variant={uploadMode === "zip" ? "default" : "outline"}
                >
                  {getMessage(
                    messages,
                    "admin.series.episodes.pages.select_zip"
                  )}
                </Button>
                <Button
                  disabled={isPending}
                  onClick={handleSelectEpub}
                  type="button"
                  variant={uploadMode === "epub" ? "default" : "outline"}
                >
                  {getMessage(
                    messages,
                    "admin.series.episodes.pages.select_epub"
                  )}
                </Button>
              </div>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>{fileLabel}</FieldLabel>
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
                  <progress
                    aria-label={getMessage(
                      messages,
                      "admin.series.episodes.pages.upload_progress"
                    )}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    {getMessage(
                      messages,
                      "admin.series.episodes.pages.processing"
                    )}
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
                  return getMessage(
                    messages,
                    "admin.series.episodes.pages.adding"
                  );
                }
                if (uploadMode === "zip") {
                  return getMessage(
                    messages,
                    "admin.series.episodes.pages.submit_zip"
                  );
                }
                if (uploadMode === "epub") {
                  return getMessage(
                    messages,
                    "admin.series.episodes.pages.submit_epub"
                  );
                }
                return getMessage(
                  messages,
                  "admin.series.episodes.pages.submit_image"
                );
              })()}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
