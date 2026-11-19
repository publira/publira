import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { AdminMessageAccessor } from "#lib/messages";
import { formatTenantAmount, readCurrency } from "#lib/price";
import { promotionCodeStatus } from "#lib/promotion-code-shared";
import type {
  PromotionCodeItem,
  PromotionCodeStatus,
  PromotionCodeTarget,
} from "#lib/promotion-code-shared";

/** What a code takes off: `10% off`, or `¥100 off` in the tenant's currency. */
export const promotionCodeDiscountLabel = (
  code: Pick<PromotionCodeItem, "discount">,
  t: AdminMessageAccessor,
  locale: Locale
): string =>
  code.discount.kind === "percent"
    ? t("admin.promotion_codes.discount_percent", {
        percent: code.discount.percent,
      })
    : t("admin.promotion_codes.discount_amount", {
        amount: formatTenantAmount(code.discount.amount, {
          currency: readCurrency(code.discount.currency),
          locale,
        }),
      });

/**
 * When a code works, in the tenant's time zone: both bounds, one of them, or
 * neither.
 */
export const promotionCodeWindowLabel = (
  code: Pick<PromotionCodeItem, "endsAt" | "startsAt">,
  t: AdminMessageAccessor,
  { locale, timeZone }: { locale: Locale; timeZone: string }
): string => {
  const startsAt = code.startsAt
    ? formatDateTime(code.startsAt, { locale, timeZone })
    : "";

  const endsAt = code.endsAt
    ? formatDateTime(code.endsAt, { locale, timeZone })
    : "";

  if (startsAt && endsAt) {
    return t("admin.promotion_codes.window.between", {
      ends_at: endsAt,
      starts_at: startsAt,
    });
  }

  if (startsAt) {
    return t("admin.promotion_codes.window.from", { starts_at: startsAt });
  }

  if (endsAt) {
    return t("admin.promotion_codes.window.until", { ends_at: endsAt });
  }

  return t("admin.promotion_codes.window.always");
};

/** How many purchases a code has discounted, against its limit if it has one. */
export const promotionCodeRedemptionsLabel = (
  code: Pick<PromotionCodeItem, "maxRedemptions" | "redemptionCount">,
  t: AdminMessageAccessor
): string =>
  code.maxRedemptions > 0
    ? t("admin.promotion_codes.redemptions_of_limit", {
        count: code.redemptionCount,
        limit: code.maxRedemptions,
      })
    : t("admin.promotion_codes.redemptions_unlimited", {
        count: code.redemptionCount,
      });

/** The kind of what a code applies to, one branch at a time. */
const TargetKindLabel = ({ target }: { target: PromotionCodeTarget }) => {
  switch (target.kind) {
    case "label": {
      return <Message message="admin.promotion_codes.target_kinds.label" />;
    }

    case "series": {
      return <Message message="admin.promotion_codes.target_kinds.series" />;
    }

    case "volume": {
      return <Message message="admin.promotion_codes.target_kinds.volume" />;
    }

    case "episode": {
      return <Message message="admin.promotion_codes.target_kinds.episode" />;
    }

    default: {
      return <Message message="admin.promotion_codes.target_kinds.catalog" />;
    }
  }
};

/**
 * What a code applies to: the whole catalog, or the kind and the title of
 * what it names, which says so once that is gone and the code applies to
 * nothing.
 */
export const PromotionCodeTargetName = ({
  target,
}: {
  target: PromotionCodeTarget;
}) => (
  <div className="grid gap-0.5">
    <span className="font-medium">
      {target.kind === "catalog" ? (
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <TargetKindLabel target={target} />
        </Suspense>
      ) : (
        target.title || (
          <span className="text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.promotion_codes.target_gone" />
            </Suspense>
          </span>
        )
      )}
    </span>
    {target.kind === "catalog" ? null : (
      <span className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <TargetKindLabel target={target} />
        </Suspense>
      </span>
    )}
  </div>
);

const StatusLabel = ({ status }: { status: PromotionCodeStatus }) => {
  switch (status) {
    case "active": {
      return <Message message="admin.promotion_codes.status.active" />;
    }

    case "scheduled": {
      return <Message message="admin.promotion_codes.status.scheduled" />;
    }

    case "paused": {
      return <Message message="admin.promotion_codes.status.paused" />;
    }

    default: {
      return <Message message="admin.promotion_codes.status.ended" />;
    }
  }
};

const statusTone = {
  active: "success",
  ended: "muted",
  paused: "warning",
  scheduled: "info",
} as const satisfies Record<PromotionCodeStatus, string>;

/** Where a code stands at `now`: Active, Scheduled, Paused, or Ended. */
export const PromotionCodeStatusChip = ({
  code,
  now,
}: {
  code: Pick<PromotionCodeItem, "endsAt" | "pausedAt" | "startsAt">;
  now: Temporal.Instant;
}) => {
  const status = promotionCodeStatus(code, now);

  return (
    <StatusChip status={statusTone[status]}>
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <StatusLabel status={status} />
      </Suspense>
    </StatusChip>
  );
};
