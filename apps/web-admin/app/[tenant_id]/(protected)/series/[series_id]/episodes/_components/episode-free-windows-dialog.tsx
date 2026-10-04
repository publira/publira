"use client";

import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
  useActionFormSettled,
} from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { useToastManager } from "@publira/ui-components/toast";
import { useState } from "react";

import { useClientMessages } from "#components/client-message";
import { InstantInput } from "#components/instant-input";
import { useTenantId } from "#lib/use-tenant-id";

import type { FreeWindowTarget } from "../_lib/free-window-target";
import {
  FREE_WINDOW_TARGETS,
  MAX_SERIES_FREE_WINDOW_EPISODES,
} from "../_lib/free-window-target";
import { useEpisodeSelection } from "./episode-selection";

interface EpisodeFreeWindowsDialogProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  seriesId: string;
  timeZone: string;
}

const isFreeWindowTarget = (value: unknown): value is FreeWindowTarget =>
  FREE_WINDOW_TARGETS.some((target) => target === value);

/** Raises the success as a toast and closes the dialog it sits in. */
const FreeWindowsSettled = ({ onSucceeded }: { onSucceeded: () => void }) => {
  const { add } = useToastManager();
  useActionFormSettled((state) => {
    if (state?.ok) {
      add({ title: state.message, type: "success" });
      onSucceeded();
    }
  });

  return null;
};

const EpisodeFreeWindowsForm = ({
  action,
  onSucceeded,
  seriesId,
  timeZone,
}: EpisodeFreeWindowsDialogProps & { onSucceeded: () => void }) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const { selectedIds } = useEpisodeSelection();
  const selectedCount = selectedIds.size;
  // The form is remounted each time the dialog opens, so this reads the
  // checks the list holds at that moment.
  const [target, setTarget] = useState<FreeWindowTarget>(
    selectedCount > 0 ? "selected" : "first"
  );

  return (
    <ActionForm action={action} className="grid gap-4" showSuccess={false}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_id" type="hidden" value={seriesId} />
      <input name="target" type="hidden" value={target} />
      <input
        name="episode_ids"
        type="hidden"
        value={JSON.stringify([...selectedIds])}
      />
      <FreeWindowsSettled onSucceeded={onSucceeded} />

      <ActionFormFieldset className="grid gap-4">
        <Field>
          <FieldLabel>
            {t("admin.series.episodes.free_windows.target")}
          </FieldLabel>
          <FieldContent>
            <RadioGroup
              items={[
                {
                  description: t(
                    "admin.series.episodes.free_windows.target_selected_description",
                    { count: String(selectedCount) }
                  ),
                  disabled: selectedCount === 0,
                  label: t(
                    "admin.series.episodes.free_windows.target_selected"
                  ),
                  value: "selected",
                },
                {
                  description: t(
                    "admin.series.episodes.free_windows.target_first_description"
                  ),
                  label: t("admin.series.episodes.free_windows.target_first"),
                  value: "first",
                },
                {
                  description: t(
                    "admin.series.episodes.free_windows.target_all_description"
                  ),
                  label: t("admin.series.episodes.free_windows.target_all"),
                  value: "all",
                },
              ]}
              onValueChange={(value) => {
                if (isFreeWindowTarget(value)) {
                  setTarget(value);
                }
              }}
              value={target}
            />
          </FieldContent>
        </Field>

        {target === "first" ? (
          <Field>
            <FieldLabel>
              {t("admin.series.episodes.free_windows.first_count")}
            </FieldLabel>
            <FieldContent>
              <Input
                className="sm:max-w-32"
                defaultValue={1}
                max={MAX_SERIES_FREE_WINDOW_EPISODES}
                min={1}
                name="first_count"
                required
                type="number"
              />
            </FieldContent>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>
              {t("admin.series.episodes.free_windows.starts_at")}
            </FieldLabel>
            <FieldContent>
              <InstantInput name="starts_at" step={60} timeZone={timeZone} />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>
              {t("admin.series.episodes.free_windows.ends_at")}
            </FieldLabel>
            <FieldContent>
              <InstantInput name="ends_at" step={60} timeZone={timeZone} />
              <FieldDescription>
                {t("admin.series.episodes.free_windows.time_zone_description", {
                  time_zone: timeZone,
                })}
              </FieldDescription>
            </FieldContent>
          </Field>
        </div>
      </ActionFormFieldset>

      <div className="flex justify-end gap-2">
        <ActionFormSubmit>
          <ActionFormIdle>
            {t("admin.series.episodes.free_windows.bulk_submit")}
          </ActionFormIdle>
          <ActionFormPending>
            {t("admin.series.episodes.free_windows.adding")}
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  );
};

/**
 * The free reading period action on the series episode list. It reads the
 * same checks the Credits action does, and also offers the first episodes and
 * the whole series, which need no checks at all. The windows it schedules
 * show on each episode's screen, where they can be reviewed and removed.
 */
export const EpisodeFreeWindowsDialog = (
  props: EpisodeFreeWindowsDialogProps
) => {
  const t = useClientMessages();
  const [open, setOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          // A message or a period typed the last time does not survive into
          // the next campaign.
          setSessionKey((current) => current + 1);
        }
      }}
      open={open}
    >
      <DialogTrigger
        render={
          <Button type="button" variant="outline">
            {t("admin.series.episodes.free_windows.bulk_action")}
          </Button>
        }
      />
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup className="flex max-h-[min(90vh,44rem)] min-h-0 w-[min(92vw,36rem)] flex-col overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">
                {t("admin.series.episodes.free_windows.bulk_title")}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {t("admin.series.episodes.free_windows.bulk_description")}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <EpisodeFreeWindowsForm
                {...props}
                key={sessionKey}
                onSucceeded={() => {
                  setOpen(false);
                }}
              />
            </div>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
};
