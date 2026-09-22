import { Button, LinkButton } from "@publira/ui-components/button";
import {
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { QrCode, toQrCodePath } from "@publira/ui-components/qr-code";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import type { EpisodePurchaseSurface } from "#lib/catalog";

import { episodeLoginHref } from "../_lib/access-gate";
import { startEpisodeCheckoutAction } from "../_lib/actions";

/**
 * The stores the tenant's app is listed in: each one's link, and above it a
 * code a phone can scan from a wider screen. A phone gets the links alone,
 * because it cannot scan a code on its own screen.
 */
const AppStoreLinks = ({
  appStoreUrl,
  googlePlayUrl,
  variant,
}: {
  appStoreUrl?: string;
  googlePlayUrl?: string;
  variant: "outline" | "secondary";
}) => (
  <div className="flex flex-wrap items-end justify-center gap-6">
    {appStoreUrl ? (
      <div className="grid justify-items-center gap-3">
        <QrCode
          {...toQrCodePath(appStoreUrl)}
          className="hidden size-32 md:block"
        />
        <LinkButton href={appStoreUrl} size="lg" variant={variant}>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.episode.gate.app_store" />
          </Suspense>
        </LinkButton>
      </div>
    ) : null}
    {googlePlayUrl ? (
      <div className="grid justify-items-center gap-3">
        <QrCode
          {...toQrCodePath(googlePlayUrl)}
          className="hidden size-32 md:block"
        />
        <LinkButton href={googlePlayUrl} size="lg" variant={variant}>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.episode.gate.google_play" />
          </Suspense>
        </LinkButton>
      </div>
    ) : null}
  </div>
);

/**
 * What stands where the pages would be when the reader may not open them: why
 * the body is closed, and the one thing that opens it.
 *
 * That action is the screen's single Shu. On an episode a reader can read, the
 * Shu is the mark on the next episode below the pages; here the next thing to
 * do is to get into this one, so the mark moves to the action that does it and
 * the row below carries none.
 */
export const EpisodeAccessGate = ({
  acceptsPayments,
  appStoreUrl,
  episodePublicId,
  googlePlayUrl,
  purchaseSurface,
  seriesPublicId,
  signedIn,
  tenantId,
}: {
  acceptsPayments: boolean;
  /** Where the tenant's app is listed; absent where it is not. */
  appStoreUrl?: string;
  episodePublicId: string;
  googlePlayUrl?: string;
  purchaseSurface: EpisodePurchaseSurface;
  seriesPublicId: string;
  signedIn: boolean;
  tenantId: string;
}) => {
  // The app buys through the same checkout, so a tenant that cannot take
  // payments has nothing to send the reader to the app for.
  const soldInAppOnly = acceptsPayments && purchaseSurface === "app";

  // Why the body is closed, in the six states the gate can be in. Each
  // branch writes its own key out: a key chosen somewhere else and handed
  // over as a value is one that nothing reading this file can account for.
  let closedBecause: ReactNode;
  if (signedIn && soldInAppOnly) {
    closedBecause = (
      <Message message="host.episode.gate.signed_in_app_only_description" />
    );
  } else if (signedIn && acceptsPayments) {
    closedBecause = (
      <Message message="host.episode.gate.signed_in_payable_description" />
    );
  } else if (signedIn) {
    closedBecause = (
      <Message message="host.episode.gate.signed_in_unpayable_description" />
    );
  } else if (soldInAppOnly) {
    closedBecause = (
      <Message message="host.episode.gate.guest_app_only_description" />
    );
  } else if (acceptsPayments) {
    closedBecause = (
      <Message message="host.episode.gate.guest_payable_description" />
    );
  } else {
    closedBecause = (
      <Message message="host.episode.gate.guest_unpayable_description" />
    );
  }

  let accessAction: ReactNode = null;
  if (signedIn && acceptsPayments && !soldInAppOnly) {
    accessAction = (
      <form action={startEpisodeCheckoutAction}>
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />
        <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
        <input name="episodePublicId" type="hidden" value={episodePublicId} />
        <Button size="lg" type="submit" variant="secondary">
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="host.episode.gate.purchase" />
          </Suspense>
        </Button>
      </form>
    );
  } else if (!signedIn) {
    accessAction = (
      <LinkButton
        render={
          <LocaleLink
            href={episodeLoginHref(seriesPublicId, episodePublicId)}
          />
        }
        size="lg"
        variant="secondary"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
          <Message message="host.episode.gate.login" />
        </Suspense>
      </LinkButton>
    );
  }

  return (
    <EmptyState>
      <EmptyStateHeading>
        <EmptyStateTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            {signedIn ? (
              <Message message="host.episode.gate.signed_in_title" />
            ) : (
              <Message message="host.episode.gate.guest_title" />
            )}
          </Suspense>
        </EmptyStateTitle>
        <EmptyStateDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-full max-w-md" />}>
            {closedBecause}
          </Suspense>
        </EmptyStateDescription>
      </EmptyStateHeading>
      <EmptyStateActions>
        <div className="grid justify-items-center gap-6">
          {/* Signed in, the store is the one way into this episode and carries
            the Shu. A guest who bought it in the app still has to sign in, so
            signing in keeps it. */}
          {soldInAppOnly && (appStoreUrl || googlePlayUrl) ? (
            <AppStoreLinks
              appStoreUrl={appStoreUrl}
              googlePlayUrl={googlePlayUrl}
              variant={signedIn ? "secondary" : "outline"}
            />
          ) : null}
          <div className="flex flex-wrap justify-center gap-3">
            {accessAction}
            <LinkButton
              render={<LocaleLink href={`/series/${seriesPublicId}`} />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="host.episode.to_series_detail" />
              </Suspense>
            </LinkButton>
          </div>
        </div>
      </EmptyStateActions>
    </EmptyState>
  );
};
