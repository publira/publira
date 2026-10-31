"use client";

import { Input } from "@publira/ui-components/input";
import Image from "next/image";
import { createContext, use, useCallback, useEffect, useState } from "react";
import type { ChangeEventHandler, ReactNode } from "react";

import { useClientMessages } from "#components/client-message";

/** The object URL of the file picked, empty until one is. */
const SeriesEyeCatchPreviewContext = createContext<string | null>(null);

const useSeriesEyeCatchPreviewUrl = (): string => {
  const previewUrl = use(SeriesEyeCatchPreviewContext);

  if (previewUrl === null) {
    throw new Error(
      "SeriesEyeCatch slots must be rendered inside a SeriesEyeCatchUpload."
    );
  }

  return previewUrl;
};

/**
 * The cover image a new series is created with, and a preview of the file
 * picked for it. Its children are `SeriesEyeCatchPreviewTitle` and
 * `SeriesEyeCatchPreview`, framed above the file input.
 */
const SeriesEyeCatchUpload = ({ children }: { children: ReactNode }) => {
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
    <SeriesEyeCatchPreviewContext value={previewUrl}>
      <div className="grid gap-4 border border-border bg-muted/20 p-4">
        <div className="border border-border bg-background p-3">{children}</div>
      </div>

      <Input
        accept="image/jpeg,image/png,image/webp"
        name="eye_catch_image"
        onChange={handleFileChange}
        type="file"
      />
    </SeriesEyeCatchPreviewContext>
  );
};

const SeriesEyeCatchPreviewTitle = ({ children }: { children: ReactNode }) => (
  <p className="mb-2 text-sm font-medium">{children}</p>
);

/**
 * The picked file at the cover's aspect ratio. Its children are
 * `SeriesEyeCatchPreviewEmpty`, which stands in until a file is picked.
 */
const SeriesEyeCatchPreview = ({ children }: { children: ReactNode }) => {
  const t = useClientMessages();
  const previewUrl = useSeriesEyeCatchPreviewUrl();

  return (
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
      ) : null}
      {children}
    </div>
  );
};

/** Its children, shown in the preview only while no file is picked. */
const SeriesEyeCatchPreviewEmpty = ({ children }: { children: ReactNode }) => {
  const previewUrl = useSeriesEyeCatchPreviewUrl();

  return previewUrl ? null : (
    <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
};

export {
  SeriesEyeCatchUpload as Root,
  SeriesEyeCatchPreview as Preview,
  SeriesEyeCatchPreviewEmpty as PreviewEmpty,
  SeriesEyeCatchPreviewTitle as PreviewTitle,
};
