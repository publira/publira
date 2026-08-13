"use client";

import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { FormMessage } from "@publira/ui-components/form-message";
import { toDateTimeLocalValue } from "@publira/utils";
import { useActionState, useCallback } from "react";

import { fillInstantFromDateTimeLocal } from "#lib/datetime-local-form";
import { useTenantId } from "#lib/use-tenant-id";

import { PublishAtInput } from "../../_components/publish-at-input";
import type { EpisodeEditActionState } from "../episode-edit-types";

interface EpisodeScheduleFormProps {
  seriesPublicId: string;
  episodePublicId: string;
  scheduledAt?: string;
  action: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
  timeZone: string;
}

export const EpisodeScheduleForm = ({
  seriesPublicId,
  episodePublicId,
  scheduledAt = "",
  action,
  timeZone,
}: EpisodeScheduleFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      fillInstantFromDateTimeLocal(event.currentTarget, {
        isoName: "publish_at",
        localName: "publish_at_local",
        timeZone,
      });
    },
    [timeZone]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>publish_at 設定</CardTitle>
        <CardDescription>
          公開予約日時を更新します。空欄で送信すると予約を解除します。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={formAction}
          className="grid gap-4"
          onSubmit={handleSubmit}
        >
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="series_public_id" type="hidden" value={seriesPublicId} />
          <input
            name="episode_public_id"
            type="hidden"
            value={episodePublicId}
          />

          <PublishAtInput
            defaultValue={toDateTimeLocalValue(scheduledAt, timeZone)}
            id="episode_edit_publish_at"
            name="publish_at"
            timeZone={timeZone}
          />

          {state && state.mode === "schedule" ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={isPending} type="submit">
              {isPending ? "更新中..." : "publish_at を更新"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
