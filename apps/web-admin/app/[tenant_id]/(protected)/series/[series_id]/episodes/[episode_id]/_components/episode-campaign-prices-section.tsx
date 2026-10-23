import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import type { EpisodeCampaignPriceItem } from "#lib/episode-campaign-price";
import {
  formatTenantAmount,
  maxPriceInputValue,
  priceInputStep,
} from "#lib/price";
import { scheduledPeriodStatus } from "#lib/scheduled-period";
import type { ScheduledPeriodStatus } from "#lib/scheduled-period";

import type { EpisodeEditActionState } from "../episode-edit-types";
import { ScheduledPeriodDeleteButton } from "./scheduled-period-delete-button";

interface EpisodeCampaignPricesSectionProps {
  campaignPrices: readonly EpisodeCampaignPriceItem[];
  createAction: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
  /** ISO 4217 code of the currency the price is entered in, the tenant's. */
  currency: string;
  deleteAction: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  episodeId: string;
  /** The episode's own price, which a campaign has to undercut. */
  episodePrice: number;
  episodePublicId: string;
  locale: Locale;
  /** The moment each campaign's standing is read against. */
  now: Temporal.Instant;
  seriesPublicId: string;
  tenantId: string;
  timeZone: string;
}

const CampaignPriceStatus = ({ status }: { status: ScheduledPeriodStatus }) => {
  switch (status) {
    case "open": {
      return (
        <StatusChip status="success">
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.series.episodes.campaign_prices.status_open" />
          </Suspense>
        </StatusChip>
      );
    }
    case "scheduled": {
      return (
        <StatusChip status="info">
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.series.episodes.campaign_prices.status_scheduled" />
          </Suspense>
        </StatusChip>
      );
    }
    default: {
      return (
        <StatusChip>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.series.episodes.campaign_prices.status_ended" />
          </Suspense>
        </StatusChip>
      );
    }
  }
};

/**
 * The periods during which this episode sells for less, each removable, and a
 * form that schedules another. The list keeps the API's order: the campaign
 * furthest ahead first, then the open one, then the ones already over.
 *
 * A free episode has no price to cut, so it is offered no form; campaigns
 * scheduled while it still had one stay listed so they can be removed.
 */
export const EpisodeCampaignPricesSection = ({
  campaignPrices,
  createAction,
  currency,
  deleteAction,
  episodeId,
  episodePrice,
  episodePublicId,
  locale,
  now,
  seriesPublicId,
  tenantId,
  timeZone,
}: EpisodeCampaignPricesSectionProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="admin.series.episodes.campaign_prices.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.series.episodes.campaign_prices.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>

    {campaignPrices.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message message="admin.series.episodes.campaign_prices.empty" />
        </Suspense>
      </p>
    ) : (
      <ul className="grid divide-y divide-border border border-border">
        {campaignPrices.map((campaign) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            key={campaign.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium tabular-nums">
                {formatTenantAmount(campaign.price, { currency, locale })}
              </span>
              <span className="text-sm tabular-nums">
                <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                  <Message
                    message="admin.series.episodes.campaign_prices.period"
                    values={{
                      ends_at: formatDateTime(campaign.endsAt, {
                        locale,
                        timeZone,
                      }),
                      starts_at: formatDateTime(campaign.startsAt, {
                        locale,
                        timeZone,
                      }),
                    }}
                  />
                </Suspense>
              </span>
              <CampaignPriceStatus
                status={scheduledPeriodStatus(campaign, now)}
              />
            </div>
            <ScheduledPeriodDeleteButton
              action={deleteAction}
              fieldName="campaign_price_id"
              messages={{
                confirmAction:
                  "admin.series.episodes.campaign_prices.delete_confirm_action",
                confirmDescription:
                  "admin.series.episodes.campaign_prices.delete_confirm_description",
                confirmTitle:
                  "admin.series.episodes.campaign_prices.delete_confirm_title",
                delete: "admin.series.episodes.campaign_prices.delete",
                deleting: "admin.series.episodes.campaign_prices.deleting",
              }}
              periodId={campaign.id}
              tenantId={tenantId}
            />
          </li>
        ))}
      </ul>
    )}

    {episodePrice > 0 ? (
      <ActionForm.Root action={createAction} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="series_public_id" type="hidden" value={seriesPublicId} />
        <input name="episode_id" type="hidden" value={episodeId} />
        <input name="episode_public_id" type="hidden" value={episodePublicId} />

        <ActionForm.Fieldset className="grid gap-4 sm:grid-cols-2">
          <Field.Root className="sm:col-span-2">
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.episodes.campaign_prices.price" />
              </Suspense>
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
              <input name="price_currency" type="hidden" value={currency} />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message
                    message="admin.series.episodes.campaign_prices.price_description"
                    values={{
                      currency,
                      price: formatTenantAmount(episodePrice, {
                        currency,
                        locale,
                      }),
                    }}
                  />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.series.episodes.campaign_prices.starts_at" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <InstantInput name="starts_at" step={60} timeZone={timeZone} />
            </Field.Content>
          </Field.Root>
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.series.episodes.campaign_prices.ends_at" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <InstantInput name="ends_at" step={60} timeZone={timeZone} />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <Message
                    message="admin.series.episodes.campaign_prices.time_zone_description"
                    values={{ time_zone: timeZone }}
                  />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>
        </ActionForm.Fieldset>

        <div className="flex justify-end gap-2">
          <ActionForm.Submit>
            <ActionForm.Idle>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.series.episodes.campaign_prices.add" />
              </Suspense>
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.series.episodes.campaign_prices.adding" />
              </Suspense>
            </ActionForm.Pending>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    ) : (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="admin.series.episodes.campaign_prices.free_episode" />
        </Suspense>
      </p>
    )}
  </AdminSection>
);
