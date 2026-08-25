import { LinkButton } from "@publira/ui-components/button";
import { EmptyState } from "@publira/ui-components/empty-state";
import Link from "next/link";
import type { ReactNode } from "react";

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
        <input name="tenantId" type="hidden" value={tenantId} />
        <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
        <input name="episodePublicId" type="hidden" value={episodePublicId} />
        <button
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          type="submit"
        >
          購入手続きへ
        </button>
      </form>
    );
  } else if (!signedIn) {
    accessAction = (
      <LinkButton
        render={
          <Link href={episodeLoginHref(seriesPublicId, episodePublicId)} />
        }
      >
        ログインして閲覧する
      </LinkButton>
    );
  }

  return (
    <EmptyState
      actions={
        <div className="flex flex-wrap justify-center gap-3">
          {accessAction}
          <LinkButton
            render={<Link href={`/series/${seriesPublicId}`} />}
            variant="outline"
          >
            シリーズ詳細へ
          </LinkButton>
        </div>
      }
      description={copy.description}
      title={copy.title}
    />
  );
};
