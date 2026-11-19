import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { BRAND_MARK_KINDS } from "#lib/brand-marks";
import type { TenantBrandMarks } from "#lib/brand-marks";

import { TenantBrandMarkCard } from "./tenant-brand-mark-card";

interface TenantBrandMarksSectionProps {
  locale: Locale;
  marks: TenantBrandMarks;
  tenantId: string;
  timeZone: string;
}

/** A card for every mark a tenant can upload, whether it has or not. */
export const TenantBrandMarksSection = ({
  locale,
  marks,
  tenantId,
  timeZone,
}: TenantBrandMarksSectionProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="admin.settings.brand_marks.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.brand_marks.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>

    <div className="grid gap-4 md:grid-cols-2">
      {BRAND_MARK_KINDS.map((kind) => (
        <TenantBrandMarkCard
          key={kind}
          kind={kind}
          locale={locale}
          mark={marks[kind] ?? null}
          tenantId={tenantId}
          timeZone={timeZone}
        />
      ))}
    </div>
  </ConsoleSection.Root>
);
