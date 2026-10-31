import Link from "next/link";

import type { AdminMessageAccessor } from "#lib/messages";
import type { PurchaseItem } from "#lib/purchase";
import { purchasedItemHref, purchasedItemLabel } from "#lib/purchased-item";

/**
 * What a purchase bought, linked to its console page, or written out where it
 * has none, as a pack of coins does not.
 */
export const PurchasedItemName = ({
  purchase,
  t,
}: {
  purchase: PurchaseItem;
  t: AdminMessageAccessor;
}) => {
  const href = purchasedItemHref(purchase);
  const label = purchasedItemLabel(purchase, t);

  if (href === null) {
    return <span className="font-medium">{label}</span>;
  }

  return (
    <Link
      className="font-medium underline-offset-4 hover:underline"
      href={href}
    >
      {label}
    </Link>
  );
};
