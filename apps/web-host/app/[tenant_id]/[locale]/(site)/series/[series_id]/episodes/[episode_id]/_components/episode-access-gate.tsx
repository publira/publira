import { Button, LinkButton } from "@publira/ui-components/button";
import {
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";

import { episodeLoginHref } from "../_lib/access-gate";
import { startEpisodeCheckoutAction } from "../_lib/actions";

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
  episodePublicId,
  seriesPublicId,
  signedIn,
  tenantId,
}: {
  acceptsPayments: boolean;
  episodePublicId: string;
  seriesPublicId: string;
  signedIn: boolean;
  tenantId: string;
}) => {
  // Why the body is closed, in the four states the gate can be in. Each
  // branch writes its own key out: a key chosen somewhere else and handed
  // over as a value is one that nothing reading this file can account for.
  let closedBecause: ReactNode;
  if (signedIn && acceptsPayments) {
    closedBecause = (
      <Message message="host.episode.gate.signed_in_payable_description" />
    );
  } else if (signedIn) {
    closedBecause = (
      <Message message="host.episode.gate.signed_in_unpayable_description" />
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
  if (signedIn && acceptsPayments) {
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
      </EmptyStateActions>
    </EmptyState>
  );
};
