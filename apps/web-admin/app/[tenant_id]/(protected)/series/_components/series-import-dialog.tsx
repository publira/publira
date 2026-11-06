"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent } from "react";

import { useClientMessages } from "#components/client-message";
import { EPISODE_PAGES_UPLOAD_MAX_BYTES } from "#lib/episode-pages-upload";
import {
  checkSeriesImport,
  SERIES_IMPORT_PATH,
  seriesImportProblemText,
} from "#lib/series-import-manifest";
import type {
  SeriesImportPlan,
  SeriesImportResponse,
  SeriesImportRow,
} from "#lib/series-import-manifest";
import { untilOnline } from "#lib/until-online";

import { SeriesImportResult } from "./series-import-result";

/** Where one import has got to. */
type ImportStep =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "refused"; problems: string[] }
  | { file: File; kind: "ready"; plan: SeriesImportPlan }
  | { file: File; kind: "importing"; plan: SeriesImportPlan }
  | { kind: "failed"; message: string }
  | {
      kind: "finished";
      message: string;
      rows: SeriesImportRow[];
      seriesPublicId: string;
    };

const readImportResponse = async (
  response: Response
): Promise<SeriesImportResponse | null> => {
  try {
    // SAFETY: the only endpoint this posts to is the import Route Handler,
    // which answers every request with this body; a body that is not JSON at
    // all rejects and is read as no answer below.
    return (await response.json()) as SeriesImportResponse;
  } catch {
    return null;
  }
};

interface SeriesImportFormProps {
  currency: string;
  onBusyChange: (busy: boolean) => void;
  seriesPublicId?: string;
}

/**
 * Checks the ZIP in the browser as soon as it is picked, so a manifest that
 * cannot be imported is answered without sending it, then posts it to the
 * route (`lib/series-import-manifest.ts`) and shows what became of each
 * episode. A send is never repeated: the import is not idempotent, and one cut
 * off on the way may still have run.
 */
const SeriesImportForm = ({
  currency,
  onBusyChange,
  seriesPublicId,
}: SeriesImportFormProps) => {
  const t = useClientMessages();
  const router = useRouter();
  const [step, setStep] = useState<ImportStep>({ kind: "idle" });

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      setStep({ kind: "idle" });

      return;
    }

    if (file.size > EPISODE_PAGES_UPLOAD_MAX_BYTES) {
      setStep({
        kind: "refused",
        problems: [t("admin.series.episodes.validation.upload_too_large")],
      });

      return;
    }

    setStep({ kind: "checking" });

    const check = checkSeriesImport(new Uint8Array(await file.arrayBuffer()), {
      currency,
      seriesPublicId,
    });

    setStep(
      check.ok
        ? { file, kind: "ready", plan: check.plan }
        : {
            kind: "refused",
            problems: check.problems.map((problem) =>
              seriesImportProblemText(t, problem)
            ),
          }
    );
  };

  const send = async (file: File): Promise<ImportStep> => {
    const formData = new FormData();
    formData.set("archive", file);

    if (seriesPublicId !== undefined) {
      formData.set("series_public_id", seriesPublicId);
    }

    await untilOnline();
    let response: Response;

    try {
      response = await fetch(SERIES_IMPORT_PATH, {
        body: formData,
        method: "POST",
      });
    } catch {
      return { kind: "failed", message: t("admin.series.import.interrupted") };
    }

    // A proxy in front with a lower limit than the route answers this itself,
    // in a body of its own.
    if (response.status === 413) {
      return {
        kind: "failed",
        message: t("admin.series.episodes.validation.upload_too_large"),
      };
    }

    const result = await readImportResponse(response);

    if (!result) {
      // No answer from the route says nothing of how far it got.
      return {
        kind: "failed",
        message: t(
          response.status >= 500
            ? "admin.series.import.interrupted"
            : "admin.series.import.failed"
        ),
      };
    }

    if (result.location) {
      router.push(result.location);
    }

    if (result.rows && result.seriesPublicId) {
      return {
        kind: "finished",
        message: result.message,
        rows: result.rows,
        seriesPublicId: result.seriesPublicId,
      };
    }

    return result.problems
      ? { kind: "refused", problems: result.problems }
      : { kind: "failed", message: result.message };
  };

  const handleImport = async () => {
    if (step.kind !== "ready") {
      return;
    }

    setStep({ ...step, kind: "importing" });
    onBusyChange(true);

    const next = await send(step.file);

    onBusyChange(false);
    setStep(next);
    router.refresh();
  };

  if (step.kind === "finished") {
    return (
      <div className="grid gap-4">
        <output className="block text-sm text-foreground">
          {step.message}
        </output>
        <div className="max-h-96 overflow-auto">
          <SeriesImportResult
            rows={step.rows}
            seriesPublicId={step.seriesPublicId}
          />
        </div>
        <Dialog.Footer>
          <LinkButton
            render={<Link href={`/series/${step.seriesPublicId}/episodes`} />}
            variant="outline"
          >
            {t("admin.series.import.open_series")}
          </LinkButton>
          <Dialog.Close render={<Button />}>
            {t("admin.series.import.close")}
          </Dialog.Close>
        </Dialog.Footer>
      </div>
    );
  }

  const pending = step.kind === "checking" || step.kind === "importing";

  return (
    <div className="grid gap-4">
      <Field.Root>
        <Field.Label>{t("admin.series.import.file_label")}</Field.Label>
        <Field.Content>
          <Input
            accept=".zip,application/zip"
            disabled={pending}
            name="archive"
            onChange={handleFileChange}
            type="file"
          />
          <Field.Description>
            {t("admin.series.import.file_help")}
          </Field.Description>
        </Field.Content>
      </Field.Root>

      {step.kind === "checking" ? (
        <output className="block text-sm text-muted-foreground">
          {t("admin.series.import.checking")}
        </output>
      ) : null}

      {step.kind === "refused" ? (
        <div className="grid gap-2" role="alert">
          <p className="text-sm font-medium text-destructive">
            {t("admin.series.import.problems_heading")}
          </p>
          <ul className="grid max-h-60 list-disc gap-1 overflow-auto pl-5 text-sm text-foreground">
            {[...new Set(step.problems)].map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {step.kind === "ready" ? (
        <output className="block text-sm text-foreground">
          {step.plan.target.kind === "new"
            ? t("admin.series.import.ready_new", {
                count: step.plan.episodes.length,
                title: step.plan.target.title,
              })
            : t("admin.series.import.ready_existing", {
                count: step.plan.episodes.length,
                id: step.plan.target.publicId,
              })}
        </output>
      ) : null}

      {step.kind === "importing" ? (
        <output className="block text-sm text-muted-foreground">
          {t("admin.series.import.submitting")}
        </output>
      ) : null}

      {step.kind === "failed" ? (
        <p className="text-sm text-destructive" role="alert">
          {step.message}
        </p>
      ) : null}

      <Dialog.Footer>
        <Dialog.Close disabled={pending} render={<Button variant="outline" />}>
          {t("admin.series.import.close")}
        </Dialog.Close>
        <Button
          disabled={step.kind !== "ready"}
          onClick={handleImport}
          type="button"
        >
          {t("admin.series.import.submit")}
        </Button>
      </Dialog.Footer>
    </div>
  );
};

interface SeriesImportDialogProps {
  /** The tenant's, which the manifest's prices are written in. */
  currency: string;
  /** Set on a series' episode list, the only series the import may add to. */
  seriesPublicId?: string;
}

/**
 * **Import from a ZIP**, on the series list and on a series' episode list. The
 * form is mounted only while the dialog is open, so each opening starts over,
 * and the dialog holds open while an import is running: closing it would lose
 * the only account of how far that import got.
 */
export const SeriesImportDialog = ({
  currency,
  seriesPublicId,
}: SeriesImportDialogProps) => {
  const t = useClientMessages();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        if (!busy) {
          setOpen(nextOpen);
        }
      }}
      open={open}
    >
      <Dialog.Trigger render={<Button type="button" variant="outline" />}>
        {t("admin.series.import.action")}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup className="flex max-h-[min(90vh,44rem)] min-h-0 w-[min(92vw,42rem)] flex-col overflow-y-auto">
            <Dialog.Header>
              <Dialog.Title className="text-lg font-semibold">
                {t("admin.series.import.action")}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                {seriesPublicId === undefined
                  ? t("admin.series.import.description")
                  : t("admin.series.import.description_series")}
              </Dialog.Description>
            </Dialog.Header>
            <div className="mt-4">
              <SeriesImportForm
                currency={currency}
                onBusyChange={setBusy}
                seriesPublicId={seriesPublicId}
              />
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
