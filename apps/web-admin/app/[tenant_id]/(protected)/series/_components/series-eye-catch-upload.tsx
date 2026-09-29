"use client";

import { Input } from "@publira/ui-components/input";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import type { ChangeEventHandler, ReactNode } from "react";

import { useClientMessages } from "#components/client-message";

/**
 * The cover image a new series is created with, and a preview of the file
 * picked for it. `empty` stands in for the preview until a file is picked.
 */
export const SeriesEyeCatchUpload = ({
  empty,
  title,
}: {
  empty: ReactNode;
  title: ReactNode;
}) => {
  const t = useClientMessages();
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl]
  );

  const handleFileChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      const file = event.currentTarget.files?.[0];

      setPreviewUrl((currentValue) => {
        if (currentValue) {
          URL.revokeObjectURL(currentValue);
        }
        return file ? URL.createObjectURL(file) : "";
      });
    },
    []
  );

  return (
    <>
      <div className="grid gap-4 border border-border bg-muted/20 p-4">
        <div className="border border-border bg-background p-3">
          <p className="mb-2 text-sm font-medium">{title}</p>
          <div className="relative aspect-[3/4] max-w-52 overflow-hidden rounded-surface border border-border bg-muted/50">
            {previewUrl ? (
              <Image
                alt={t("admin.series.form.eye_catch_preview_alt")}
                className="h-full w-full object-cover"
                fill
                sizes="(max-width: 768px) 100vw, 240px"
                src={previewUrl}
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                {empty}
              </div>
            )}
          </div>
        </div>
      </div>

      <Input
        accept="image/jpeg,image/png,image/webp"
        name="eye_catch_image"
        onChange={handleFileChange}
        type="file"
      />
    </>
  );
};
