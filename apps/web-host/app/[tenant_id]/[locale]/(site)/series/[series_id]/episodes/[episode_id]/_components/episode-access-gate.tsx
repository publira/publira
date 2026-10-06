import type { Locale } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import { QrCode, toQrCodePath } from "@publira/ui-components/qr-code";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTimeWithWeekday, formatDuration } from "@publira/utils";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import type { EpisodeNeighborItem, EpisodePurchaseSurface } from "#lib/catalog";

import { episodeLoginHref } from "../_lib/access-gate";
import {
  openWithWaitFreeTicketAction,
  startEpisodeCheckoutAction,
} from "../_lib/actions";
import { episodePath } from "../_lib/episode-path";
import type { WaitFreeOffer } from "../_lib/wait-free-offer";
import { WaitFreeCountdown } from "./wait-free-countdown";

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
 * Why the body is closed, in the six states the gate can be in. Each branch
 * writes its own key out: a key chosen somewhere else and handed over as a
 * value is one that nothing reading this file can account for.
 */
const ClosedBecause = ({
  acceptsPayments,
  signedIn,
  soldInAppOnly,
}: {
  acceptsPayments: boolean;
  signedIn: boolean;
  soldInAppOnly: boolean;
}) => {
  if (signedIn && soldInAppOnly) {
    return (
      <Message message="host.episode.gate.signed_in_app_only_description" />
    );
  }
  if (signedIn && acceptsPayments) {
    return (
      <Message message="host.episode.gate.signed_in_payable_description" />
    );
  }
  if (signedIn) {
    return (
      <Message message="host.episode.gate.signed_in_unpayable_description" />
    );
  }
  if (soldInAppOnly) {
    return <Message message="host.episode.gate.guest_app_only_description" />;
  }
  if (acceptsPayments) {
    return <Message message="host.episode.gate.guest_payable_description" />;
  }
  return <Message message="host.episode.gate.guest_unpayable_description" />;
};

/**
 * The reader's ticket is ready: what it does, and the control that spends it.
 */
const WaitFreeTicketForm = ({
  accessHours,
  episodeId,
  episodePublicId,
  locale,
  seriesPublicId,
  tenantId,
  variant,
}: {
  accessHours: number;
  episodeId: string;
  episodePublicId: string;
  locale: Locale;
  seriesPublicId: string;
  tenantId: string;
  variant: "outline" | "secondary";
}) => (
  <div className="grid justify-items-center gap-3">
    <p className="text-sm">
      <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
        <Message
          message="host.episode.gate.wait_free_ready"
          values={{
            access: formatDuration({ hours: accessHours }, { locale }),
          }}
        />
      </Suspense>
    </p>
    <form action={openWithWaitFreeTicketAction}>
      <LocaleField />
      <input name="tenantId" type="hidden" value={tenantId} />
      <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
      <input name="episodePublicId" type="hidden" value={episodePublicId} />
      <input name="episodeId" type="hidden" value={episodeId} />
      <Button size="lg" type="submit" variant={variant}>
        <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
          <Message message="host.episode.gate.wait_free_use" />
        </Suspense>
      </Button>
    </form>
  </div>
);

/**
 * What the gate says about wait-for-free, in the five states the offer can be
 * in, each with its own key written out for the reason the gate gives.
 *
 * A ticket that is ready is the Shu, which the gate takes from the purchase.
 * One still recharging becomes ready while the reader looks at the page, after
 * the gate has given the Shu to whatever else was on screen, so the control it
 * then offers is outlined; the next load of the page makes it the Shu.
 */
const WaitFreeSection = ({
  episodeId,
  episodePublicId,
  locale,
  offer,
  seriesPublicId,
  tenantId,
  timeZone,
}: {
  episodeId: string;
  episodePublicId: string;
  locale: Locale;
  offer: WaitFreeOffer;
  seriesPublicId: string;
  tenantId: string;
  timeZone: string;
}) => {
  const ticketProps = {
    episodeId,
    episodePublicId,
    locale,
    seriesPublicId,
    tenantId,
  };

  switch (offer.kind) {
    case "ready": {
      return (
        <WaitFreeTicketForm
          {...ticketProps}
          accessHours={offer.accessHours}
          variant="secondary"
        />
      );
    }
    case "recharging": {
      return (
        <WaitFreeCountdown
          absolute={formatDateTimeWithWeekday(offer.nextAvailableAt, {
            fallback: "",
            locale,
            timeZone,
          })}
          nextAvailableAt={offer.nextAvailableAt}
        >
          <WaitFreeTicketForm
            {...ticketProps}
            accessHours={offer.accessHours}
            variant="outline"
          />
        </WaitFreeCountdown>
      );
    }
    case "excluded": {
      return (
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="host.episode.gate.wait_free_excluded" />
          </Suspense>
        </p>
      );
    }
    case "guest": {
      return (
        <p className="text-sm">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="host.episode.gate.wait_free_guest" />
          </Suspense>
        </p>
      );
    }
    default: {
      return (
        <output className="block text-sm text-muted-foreground">
          {offer.message}
        </output>
      );
    }
  }
};

/**
 * The card over the preview when the reader may not open the pages: why the
 * body is closed, the one thing that opens it, and the nearest later episode
 * they could read instead.
 *
 * That action is the screen's single Shu. On an episode a reader can read, the
 * Shu is the mark on the next episode below the pages; here the next thing to
 * do is to get into this one, so the mark moves to the action that does it and
 * the row below carries none. The free episode is a way around this one rather
 * than into it, so it is a link under the actions and not a third button.
 *
 * On a series that offers wait-for-free, a ready ticket is the way in that
 * costs the reader nothing, so it takes the Shu from the purchase. A ticket
 * still recharging counts down to the moment it is ready and then offers
 * itself, without taking the Shu from an action already on screen.
 */
export const EpisodeAccessGate = ({
  acceptsPayments,
  appStoreUrl,
  episodeId,
  episodePublicId,
  googlePlayUrl,
  locale,
  nextFreeEpisode,
  purchaseSurface,
  seriesPublicId,
  signedIn,
  tenantId,
  timeZone,
  waitFree,
}: {
  acceptsPayments: boolean;
  /** Where the tenant's app is listed; absent where it is not. */
  appStoreUrl?: string;
  episodeId: string;
  episodePublicId: string;
  googlePlayUrl?: string;
  locale: Locale;
  /** Absent when no later episode of the series is free right now. */
  nextFreeEpisode?: EpisodeNeighborItem;
  purchaseSurface: EpisodePurchaseSurface;
  seriesPublicId: string;
  signedIn: boolean;
  tenantId: string;
  /** The tenant's time zone, which a recharging ticket's instant is written in. */
  timeZone: string;
  /** Absent on a series that does not offer wait-for-free. */
  waitFree?: WaitFreeOffer;
}) => {
  // The app buys through the same checkout, so a tenant that cannot take
  // payments has nothing to send the reader to the app for.
  const soldInAppOnly = acceptsPayments && purchaseSurface === "app";

  const ticketReady = waitFree?.kind === "ready";

  let accessAction: ReactNode = null;
  if (signedIn && acceptsPayments && !soldInAppOnly) {
    accessAction = (
      <form action={startEpisodeCheckoutAction}>
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />
        <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
        <input name="episodePublicId" type="hidden" value={episodePublicId} />
        <input name="episodeId" type="hidden" value={episodeId} />
        <Button
          size="lg"
          type="submit"
          variant={ticketReady ? "outline" : "secondary"}
        >
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
    <div className="grid gap-6">
      <div className="grid gap-2">
        <p className="font-serif text-xl leading-tight">
          <Suspense fallback={<SkeletonLine className="mx-auto h-5 w-64" />}>
            {signedIn ? (
              <Message message="host.episode.gate.signed_in_title" />
            ) : (
              <Message message="host.episode.gate.guest_title" />
            )}
          </Suspense>
        </p>
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <ClosedBecause
              acceptsPayments={acceptsPayments}
              signedIn={signedIn}
              soldInAppOnly={soldInAppOnly}
            />
          </Suspense>
        </p>
      </div>
      <div className="grid justify-items-center gap-6">
        {waitFree ? (
          <WaitFreeSection
            episodeId={episodeId}
            episodePublicId={episodePublicId}
            locale={locale}
            offer={waitFree}
            seriesPublicId={seriesPublicId}
            tenantId={tenantId}
            timeZone={timeZone}
          />
        ) : null}
        {/* Signed in, the store is the one way into this episode and carries
          the Shu, unless a ready ticket opens it for nothing. A guest who
          bought it in the app still has to sign in, so signing in keeps it. */}
        {soldInAppOnly && (appStoreUrl || googlePlayUrl) ? (
          <AppStoreLinks
            appStoreUrl={appStoreUrl}
            googlePlayUrl={googlePlayUrl}
            variant={signedIn && !ticketReady ? "secondary" : "outline"}
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
        {nextFreeEpisode ? (
          <LinkButton
            render={
              <LocaleLink
                href={episodePath(seriesPublicId, nextFreeEpisode.publicId)}
              />
            }
            variant="link"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message
                message="host.episode.gate.next_free_episode"
                values={{ number: nextFreeEpisode.orderIndex }}
              />
            </Suspense>
          </LinkButton>
        ) : null}
      </div>
    </div>
  );
};
