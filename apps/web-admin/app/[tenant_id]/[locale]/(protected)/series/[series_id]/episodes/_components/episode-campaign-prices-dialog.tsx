"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import * as Toast from "@publira/ui-components/toast";
import { useState } from "react";

import { useClientMessages } from "#components/client-message";
import { InstantInput } from "#components/instant-input";
import { maxPriceInputValue, priceInputStep } from "#lib/price";
import { useTenantId } from "#lib/use-tenant-id";

import { useEpisodeSelection } from "./episode-selection";

interface EpisodeCampaignPricesDialogProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  /** ISO 4217 code of the currency the price is entered in, the tenant's. */
  currency: string;
  seriesId: string;
  timeZone: string;
}

/** Raises the success as a toast and closes the dialog it sits in. */
const CampaignPricesSettled = ({
  onSucceeded,
}: {
  onSucceeded: () => void;
}) => {
  const { add } = Toast.useManager();
  ActionForm.useSettled((state) => {
    if (state?.ok) {
      add({ title: state.message, type: "success" });
      onSucceeded();
    }
  });

  return null;
};

const EpisodeCampaignPricesForm = ({
  action,
  currency,
  onSucceeded,
  seriesId,
  timeZone,
}: EpisodeCampaignPricesDialogProps & { onSucceeded: () => void }) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const { selectedIds } = useEpisodeSelection();
  const selectedCount = selectedIds.size;

  return (
    <ActionForm.Root action={action} className="grid gap-4" showSuccess={false}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_id" type="hidden" value={seriesId} />
      <input
        name="episode_ids"
        type="hidden"
        value={JSON.stringify([...selectedIds])}
      />
      <input name="price_currency" type="hidden" value={currency} />
      <CampaignPricesSettled onSucceeded={onSucceeded} />

      <p className="text-sm">
        {selectedCount > 0
          ? t("admin.series.episodes.campaign_prices.bulk_selected", {
              count: selectedCount,
            })
          : t("admin.series.episodes.campaign_prices.bulk_none_selected")}
      </p>

      <ActionForm.Fieldset
        className="grid gap-4"
        disabled={selectedCount === 0}
      >
        <Field.Root>
          <Field.Label required>
            {t("admin.series.episodes.campaign_prices.price")}
          </Field.Label>
          <Field.Content>
            <Input
              className="sm:max-w-48"
              max={maxPriceInputValue(currency)}
              min={priceInputStep(currency)}
              name="price"
              required
              step={priceInputStep(currency)}
              type="number"
            />
            <Field.Description>
              {t(
                "admin.series.episodes.campaign_prices.bulk_price_description",
                { currency }
              )}
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field.Root>
            <Field.Label>
              {t("admin.series.episodes.campaign_prices.starts_at")}
            </Field.Label>
            <Field.Content>
              <InstantInput name="starts_at" step={60} timeZone={timeZone} />
            </Field.Content>
          </Field.Root>
          <Field.Root>
            <Field.Label>
              {t("admin.series.episodes.campaign_prices.ends_at")}
            </Field.Label>
            <Field.Content>
              <InstantInput name="ends_at" step={60} timeZone={timeZone} />
              <Field.Description>
                {t(
                  "admin.series.episodes.campaign_prices.time_zone_description",
                  { time_zone: timeZone }
                )}
              </Field.Description>
            </Field.Content>
          </Field.Root>
        </div>
      </ActionForm.Fieldset>

      <div className="flex justify-end gap-2">
        <ActionForm.Submit disabled={selectedCount === 0}>
          <ActionForm.Idle>
            {t("admin.series.episodes.campaign_prices.bulk_submit")}
          </ActionForm.Idle>
          <ActionForm.Pending>
            {t("admin.series.episodes.campaign_prices.adding")}
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  );
};

/**
 * The campaign price action on the series episode list. It schedules the same
 * price and period on the episodes checked on the list, which a campaign has
 * to name: unlike a free reading period, it cannot cover a whole series, whose
 * free episodes have no price to cut. The campaigns it schedules show on each
 * episode's screen, where they can be reviewed and removed.
 */
export const EpisodeCampaignPricesDialog = (
  props: EpisodeCampaignPricesDialogProps
) => {
  const t = useClientMessages();
  const [open, setOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);

        if (nextOpen) {
          // A message, a price, or a period typed the last time does not
          // survive into the next campaign.
          setSessionKey((current) => current + 1);
        }
      }}
      open={open}
    >
      <Dialog.Trigger
        render={
          <Button type="button" variant="outline">
            {t("admin.series.episodes.campaign_prices.bulk_action")}
          </Button>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup className="flex max-h-[min(90vh,44rem)] min-h-0 w-[min(92vw,36rem)] flex-col overflow-y-auto">
            <Dialog.Header>
              <Dialog.Title className="text-lg font-semibold">
                {t("admin.series.episodes.campaign_prices.bulk_title")}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                {t("admin.series.episodes.campaign_prices.bulk_description")}
              </Dialog.Description>
            </Dialog.Header>
            <div className="mt-4">
              <EpisodeCampaignPricesForm
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
