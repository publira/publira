import type { Locale } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";

import { getMessagesFor } from "#lib/messages";

import type { CampaignBannerListItem } from "../campaign-banner-types";
import { CampaignBannerList } from "./campaign-banner-list";

interface CampaignBannerManagerProps {
  banners: CampaignBannerListItem[];
  /** Whether the operator may write the banners, which a tenant auditor may not. */
  canEdit: boolean;
  listErrorMessage?: string;
  locale: Locale;
  /** The moment each banner's standing is judged against. */
  now: Temporal.Instant;
  tenantId: string;
  /** The tenant's display zone, which every window is shown in. */
  timeZone: string;
}

export const CampaignBannerManager = async ({
  banners,
  canEdit,
  listErrorMessage,
  locale,
  now,
  tenantId,
  timeZone,
}: CampaignBannerManagerProps) => {
  const t = await getMessagesFor(locale);
  // A failed read still hands an empty array; the empty state next to the
  // error would read as "this tenant has no banners".
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            {t("admin.campaign_banners.list_error")}
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (banners.length === 0) {
    return (
      <EmptyState>
        <EmptyStateHeading>
          <EmptyStateTitle>
            {t("admin.campaign_banners.empty_title")}
          </EmptyStateTitle>
          <EmptyStateDescription>
            {canEdit
              ? t("admin.campaign_banners.empty_description")
              : t("admin.campaign_banners.empty_description_read_only")}
          </EmptyStateDescription>
        </EmptyStateHeading>
      </EmptyState>
    );
  }

  return (
    <CampaignBannerList
      banners={banners}
      canEdit={canEdit}
      locale={locale}
      now={now}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};
