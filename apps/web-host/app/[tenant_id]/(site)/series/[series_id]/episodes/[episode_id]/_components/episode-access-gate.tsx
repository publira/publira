import { LinkButton } from "@publira/ui-components/button";
import { EmptyState } from "@publira/ui-components/empty-state";
import Link from "next/link";

import { episodeAccessGateCopy, episodeLoginHref } from "../_lib/access-gate";

export const EpisodeAccessGate = ({
  episodePublicId,
  seriesPublicId,
  signedIn,
}: {
  episodePublicId: string;
  seriesPublicId: string;
  signedIn: boolean;
}) => {
  const copy = episodeAccessGateCopy(signedIn);

  return (
    <EmptyState
      actions={
        <div className="flex flex-wrap justify-center gap-3">
          {signedIn ? null : (
            <LinkButton
              render={
                <Link
                  href={episodeLoginHref(seriesPublicId, episodePublicId)}
                />
              }
            >
              ログインして閲覧する
            </LinkButton>
          )}
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
