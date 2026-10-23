"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
import * as Toast from "@publira/ui-components/toast";
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
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  seriesId: string;
  timeZone: string;
}

const isFreeWindowTarget = (value: unknown): value is FreeWindowTarget =>
  FREE_WINDOW_TARGETS.some((target) => target === value);

/** Raises the success as a toast and closes the dialog it sits in. */
const FreeWindowsSettled = ({ onSucceeded }: { onSucceeded: () => void }) => {
  const { add } = Toast.useManager();
  ActionForm.useSettled((state) => {
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
    <ActionForm.Root action={action} className="grid gap-4" showSuccess={false}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_id" type="hidden" value={seriesId} />
      <input name="target" type="hidden" value={target} />
      <input
        name="episode_ids"
        type="hidden"
        value={JSON.stringify([...selectedIds])}
      />
      <FreeWindowsSettled onSucceeded={onSucceeded} />

      <ActionForm.Fieldset className="grid gap-4">
        <Field.Root>
          <Field.Label>
            {t("admin.series.episodes.free_windows.target")}
          </Field.Label>
          <Field.Content>
            <RadioGroup
              items={[
                {
                  description: t(
                    "admin.series.episodes.free_windows.target_selected_description",
                    { count: selectedCount }
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
          </Field.Content>
        </Field.Root>

        {target === "first" ? (
          <Field.Root>
            <Field.Label>
              {t("admin.series.episodes.free_windows.first_count")}
            </Field.Label>
            <Field.Content>
              <Input
                className="sm:max-w-32"
                defaultValue={1}
                max={MAX_SERIES_FREE_WINDOW_EPISODES}
                min={1}
                name="first_count"
                required
                type="number"
              />
            </Field.Content>
          </Field.Root>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field.Root>
            <Field.Label>
              {t("admin.series.episodes.free_windows.starts_at")}
            </Field.Label>
            <Field.Content>
              <InstantInput name="starts_at" step={60} timeZone={timeZone} />
            </Field.Content>
          </Field.Root>
          <Field.Root>
            <Field.Label>
              {t("admin.series.episodes.free_windows.ends_at")}
            </Field.Label>
            <Field.Content>
              <InstantInput name="ends_at" step={60} timeZone={timeZone} />
              <Field.Description>
                {t("admin.series.episodes.free_windows.time_zone_description", {
                  time_zone: timeZone,
                })}
              </Field.Description>
            </Field.Content>
          </Field.Root>
        </div>
      </ActionForm.Fieldset>

      <div className="flex justify-end gap-2">
        <ActionForm.Submit>
          <ActionForm.Idle>
            {t("admin.series.episodes.free_windows.bulk_submit")}
          </ActionForm.Idle>
          <ActionForm.Pending>
            {t("admin.series.episodes.free_windows.adding")}
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
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
    <Dialog.Root
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
      <Dialog.Trigger
        render={
          <Button type="button" variant="outline">
            {t("admin.series.episodes.free_windows.bulk_action")}
          </Button>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup className="flex max-h-[min(90vh,44rem)] min-h-0 w-[min(92vw,36rem)] flex-col overflow-y-auto">
            <Dialog.Header>
              <Dialog.Title className="text-lg font-semibold">
                {t("admin.series.episodes.free_windows.bulk_title")}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                {t("admin.series.episodes.free_windows.bulk_description")}
              </Dialog.Description>
            </Dialog.Header>
            <div className="mt-4">
              <EpisodeFreeWindowsForm
                {...props}
                key={sessionKey}
                onSucceeded={() => {
                  setOpen(false);
                }}
              />
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
