"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Input } from "@publira/ui-components/input";
import { createContext, use, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode, RefObject } from "react";

type EpisodePagesUploadMode = "epub" | "pages" | "zip";

/** What the file input takes in each mode. */
const FILE_INPUT: Record<
  EpisodePagesUploadMode,
  { accept: string; multiple: boolean; name: string }
> = {
  epub: {
    accept: ".epub,application/epub+zip",
    multiple: false,
    name: "archive",
  },
  pages: { accept: "image/*", multiple: true, name: "pages" },
  zip: { accept: ".zip,application/zip", multiple: false, name: "archive" },
};

interface EpisodePagesUploadContextValue {
  inputRef: RefObject<HTMLInputElement | null>;
  mode: EpisodePagesUploadMode;
  selectedFileNames: string[];
  setMode: (mode: EpisodePagesUploadMode) => void;
  setSelectedFileNames: (fileNames: string[]) => void;
}

const EpisodePagesUploadContext =
  createContext<EpisodePagesUploadContextValue | null>(null);

const useEpisodePagesUpload = () => {
  const context = use(EpisodePagesUploadContext);
  if (!context) {
    throw new Error(
      "EpisodePagesUpload slots must be rendered inside EpisodePagesUpload."
    );
  }
  return context;
};

const toFileNames = (files: FileList | null) =>
  files ? [...files].map((file) => file.name) : [];

/**
 * Whether the pages arrive as images, a ZIP, or an ePub, and the files picked
 * for it. The mode travels with the form so the Action knows what it is given.
 */
export const EpisodePagesUpload = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<EpisodePagesUploadMode>("pages");
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // A successful upload empties the file input, and the names listed for it
  // with it.
  useActionFormSettled((state) => {
    if (state?.ok) {
      setSelectedFileNames([]);
    }
  });

  const context = useMemo(
    () => ({
      inputRef,
      mode,
      selectedFileNames,
      // Files picked for one mode mean nothing to another.
      setMode: (nextMode: EpisodePagesUploadMode) => {
        setMode(nextMode);
        setSelectedFileNames([]);
        if (inputRef.current) {
          inputRef.current.value = "";
        }
      },
      setSelectedFileNames,
    }),
    [mode, selectedFileNames]
  );

  return (
    <EpisodePagesUploadContext value={context}>
      <input name="upload_mode" type="hidden" value={mode} />
      {children}
    </EpisodePagesUploadContext>
  );
};

/** Switches the upload to `mode`; `children` are the control's wording. */
export const EpisodePagesModeButton = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: EpisodePagesUploadMode;
}) => {
  const { mode: current, setMode } = useEpisodePagesUpload();

  return (
    <Button
      onClick={() => setMode(mode)}
      type="button"
      variant={current === mode ? "default" : "outline"}
    >
      {children}
    </Button>
  );
};

/** Renders its children while the upload is in `mode`. */
export const EpisodePagesWhile = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: EpisodePagesUploadMode;
}) => (useEpisodePagesUpload().mode === mode ? children : null);

/**
 * The file input, and the area around it a file can be dropped on; `children`
 * say what to drop.
 */
export const EpisodePagesDropZone = ({ children }: { children: ReactNode }) => {
  const { inputRef, mode, setSelectedFileNames } = useEpisodePagesUpload();
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInput = FILE_INPUT[mode];

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const { files } = event.dataTransfer;
    // A closed input belongs to an upload already in flight.
    if (
      !inputRef.current ||
      inputRef.current.matches(":disabled") ||
      files.length === 0
    ) {
      return;
    }

    const droppedFiles = fileInput.multiple
      ? [...files]
      : [files[0]].filter(Boolean);

    const dataTransfer = new DataTransfer();
    for (const file of droppedFiles) {
      dataTransfer.items.add(file);
    }
    inputRef.current.files = dataTransfer.files;
    setSelectedFileNames(toFileNames(dataTransfer.files));
  };

  return (
    <div
      className={
        isDragOver
          ? "border-2 border-dashed border-foreground/60 bg-muted/50 p-4"
          : "border-2 border-dashed border-border p-4"
      }
      onDragEnter={handleDragOver}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragOver(false);
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      <Input
        accept={fileInput.accept}
        multiple={fileInput.multiple}
        name={fileInput.name}
        onChange={(event) => {
          setSelectedFileNames(toFileNames(event.currentTarget.files));
        }}
        ref={inputRef}
        required
        type="file"
      />
    </div>
  );
};

/** The names of the files picked, as a check before they are uploaded. */
export const EpisodePagesSelectedFiles = () => {
  const { selectedFileNames } = useEpisodePagesUpload();

  return selectedFileNames.length > 0 ? (
    <div className="grid gap-1 text-xs text-muted-foreground">
      {selectedFileNames.map((fileName) => (
        <p key={fileName}>{fileName}</p>
      ))}
    </div>
  ) : null;
};
