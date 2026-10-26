import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { CoinDisclosuresItem } from "#lib/coins";

/**
 * What the tenant discloses about its coins, set beside every pack the site
 * sells: who issues them, the terms they are sold under, how to reach the
 * issuer, and the tenant's own notice. A field the tenant left empty is left
 * out rather than shown as not set.
 */
export const CoinDisclosures = ({
  disclosures,
}: {
  disclosures: CoinDisclosuresItem;
}) => {
  const { contact, issuerName, notice, termsUrl } = disclosures;
  if (!(contact || issuerName || notice || termsUrl)) {
    return null;
  }

  return (
    <div className="grid gap-2 text-sm text-muted-foreground">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-left">
        {issuerName ? (
          <>
            <dt>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="storefront.coins.issuer" />
              </Suspense>
            </dt>
            <dd className="text-foreground">{issuerName}</dd>
          </>
        ) : null}
        {termsUrl ? (
          <>
            <dt>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="storefront.coins.terms" />
              </Suspense>
            </dt>
            <dd>
              <a
                className="text-primary underline underline-offset-4"
                href={termsUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="storefront.coins.terms_link" />
                </Suspense>
              </a>
            </dd>
          </>
        ) : null}
        {contact ? (
          <>
            <dt>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="storefront.coins.contact" />
              </Suspense>
            </dt>
            <dd className="break-words text-foreground">{contact}</dd>
          </>
        ) : null}
      </dl>
      {notice ? (
        <p className="text-left whitespace-pre-line">{notice}</p>
      ) : null}
    </div>
  );
};
