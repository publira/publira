import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { CoinStatus } from "#lib/coins";

const STATUS_TONE: Record<CoinStatus, BadgeTone> = {
  not_selling: "warning",
  off: "muted",
  selling: "success",
};

interface CoinStatusSummaryProps {
  /** The tenant's word for its coins in the console's language, or the console's own. */
  coinName: string;
  status: CoinStatus;
}

/**
 * Which of the three states the tenant's coins are in, named the way the
 * documentation names them, with what each means for readers, above the
 * statement of what issuing them makes the tenant responsible for.
 */
export const CoinStatusSummary = ({
  coinName,
  status,
}: CoinStatusSummaryProps) => {
  const values = { coin_name: coinName };

  return (
    <ConsoleSection.Root>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.coins.status.label" />
            </Suspense>
          </p>
          <StatusChip status={STATUS_TONE[status]}>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              {status === "selling" ? (
                <Message message="admin.coins.status.selling" />
              ) : null}
              {status === "not_selling" ? (
                <Message message="admin.coins.status.not_selling" />
              ) : null}
              {status === "off" ? (
                <Message message="admin.coins.status.off" />
              ) : null}
            </Suspense>
          </StatusChip>
        </div>
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            {status === "selling" ? (
              <Message
                message="admin.coins.status.selling_description"
                values={values}
              />
            ) : null}
            {status === "not_selling" ? (
              <Message
                message="admin.coins.status.not_selling_description"
                values={values}
              />
            ) : null}
            {status === "off" ? (
              <Message
                message="admin.coins.status.off_description"
                values={values}
              />
            ) : null}
          </Suspense>
        </p>
      </div>
      <p className="max-w-3xl border-l-2 border-border pl-3 text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.coins.prepaid_notice" />
        </Suspense>
      </p>
    </ConsoleSection.Root>
  );
};
