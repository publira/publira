import { LinkButton } from "@publira/ui-components/button";
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

import { episodeAccessGateCopy, episodeLoginHref } from "../_lib/access-gate";
import { startEpisodeCheckoutAction } from "../_lib/actions";

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
  const copy = episodeAccessGateCopy(signedIn, acceptsPayments);
  let accessAction: ReactNode = null;
  if (signedIn && acceptsPayments) {
    accessAction = (
      <form action={startEpisodeCheckoutAction}>
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />
        <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
        <input name="episodePublicId" type="hidden" value={episodePublicId} />
        <button
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          type="submit"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="host.episode.gate.purchase" />
          </Suspense>
        </button>
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
            <Message message={copy.title} />
          </Suspense>
        </EmptyStateTitle>
        <EmptyStateDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-full max-w-md" />}>
            <Message message={copy.description} />
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
