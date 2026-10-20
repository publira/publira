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
import { useToastManager } from "@publira/ui-components/toast";
import { useState } from "react";

import { useClientMessages } from "#components/client-message";
import { InstantInput } from "#components/instant-input";
import { maxPriceInputValue, priceInputStep } from "#lib/price";
import { useTenantId } from "#lib/use-tenant-id";

import { useEpisodeSelection } from "./episode-selection";

interface EpisodeCampaignPricesDialogProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
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
  const { add } = useToastManager();
  useActionFormSettled((state) => {
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
    <ActionForm action={action} className="grid gap-4" showSuccess={false}>
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

      <ActionFormFieldset className="grid gap-4" disabled={selectedCount === 0}>
        <Field>
          <FieldLabel required>
            {t("admin.series.episodes.campaign_prices.price")}
          </FieldLabel>
          <FieldContent>
            <Input
              className="sm:max-w-48"
              max={maxPriceInputValue(currency)}
              min={priceInputStep(currency)}
              name="price"
              required
              step={priceInputStep(currency)}
              type="number"
            />
            <FieldDescription>
              {t(
                "admin.series.episodes.campaign_prices.bulk_price_description",
                { currency }
              )}
            </FieldDescription>
          </FieldContent>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>
              {t("admin.series.episodes.campaign_prices.starts_at")}
            </FieldLabel>
            <FieldContent>
              <InstantInput name="starts_at" step={60} timeZone={timeZone} />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>
              {t("admin.series.episodes.campaign_prices.ends_at")}
            </FieldLabel>
            <FieldContent>
              <InstantInput name="ends_at" step={60} timeZone={timeZone} />
              <FieldDescription>
                {t(
                  "admin.series.episodes.campaign_prices.time_zone_description",
                  { time_zone: timeZone }
                )}
              </FieldDescription>
            </FieldContent>
          </Field>
        </div>
      </ActionFormFieldset>

      <div className="flex justify-end gap-2">
        <ActionFormSubmit disabled={selectedCount === 0}>
          <ActionFormIdle>
            {t("admin.series.episodes.campaign_prices.bulk_submit")}
          </ActionFormIdle>
          <ActionFormPending>
            {t("admin.series.episodes.campaign_prices.adding")}
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
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
    <Dialog
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
      <DialogTrigger
        render={
          <Button type="button" variant="outline">
            {t("admin.series.episodes.campaign_prices.bulk_action")}
          </Button>
        }
      />
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup className="flex max-h-[min(90vh,44rem)] min-h-0 w-[min(92vw,36rem)] flex-col overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">
                {t("admin.series.episodes.campaign_prices.bulk_title")}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {t("admin.series.episodes.campaign_prices.bulk_description")}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <EpisodeCampaignPricesForm
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
