import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getLocale } from "#lib/locale";
import { listAllSeries } from "#lib/series";
import { listSubscriptionPlanNames } from "#lib/subscription-plan";
import { findTenantLocales } from "#lib/tenant-locales";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type {
  AnnouncementItem,
  CreateAnnouncementActionState,
} from "../announcement-types";
import { AnnouncementForm } from "./announcement-form";

/** The plans a subscription condition can name, by name. */
const readAudiencePlans = async (tenantId: string) => {
  const result = await listSubscriptionPlanNames(
    tenantId,
    await getLocale(tenantId)
  );

  return result.ok
    ? { plans: result.plans }
    : { message: result.message, plans: [] };
};

/**
 * The announcement form with everything it offers read for it: the site's
 * languages, its time zone, and the series and plans the audience conditions
 * pick from. A list that cannot be read leaves its control empty with the
 * reason beside it, and the rest of the form usable.
 *
 * The languages are the exception on edit. Without them the form takes the
 * default language alone, and a save replaces every translation with what it
 * posts, so it would delete the others: the edit screen says it cannot open
 * instead.
 */
export const AnnouncementFormData = async ({
  action,
  announcement,
  tenantId,
}: {
  action: (
    prevState: CreateAnnouncementActionState,
    formData: FormData
  ) => Promise<CreateAnnouncementActionState>;
  announcement?: AnnouncementItem;
  tenantId: string;
}) => {
  const [tenantLocales, timeZone, seriesResult, plansResult] =
    await Promise.all([
      findTenantLocales(tenantId),
      getTenantDisplayTimeZone(tenantId),
      listAllSeries(),
      readAudiencePlans(tenantId),
    ]);

  if (announcement && !tenantLocales) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.announcements.edit_unavailable_title" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.announcements.edit_unavailable_description" />
            </Suspense>
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  return (
    <AnnouncementForm
      action={action}
      announcement={announcement}
      plans={plansResult.plans}
      plansErrorMessage={plansResult.message}
      series={seriesResult.series}
      seriesErrorMessage={seriesResult.ok ? undefined : seriesResult.message}
      tenantId={tenantId}
      tenantLocales={tenantLocales}
      timeZone={timeZone}
    />
  );
};
