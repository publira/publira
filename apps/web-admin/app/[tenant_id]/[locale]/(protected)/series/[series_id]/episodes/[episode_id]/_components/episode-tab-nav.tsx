import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

import { Message } from "#components/message";

interface EpisodeTabNavProps {
  current: "basic" | "eye-catch";
  episodeId: string;
  seriesId: string;
}

export const EpisodeTabNav = ({
  current,
  episodeId,
  seriesId,
}: EpisodeTabNavProps) => {
  const episodePath = `/series/${seriesId}/episodes/${episodeId}`;

  return (
    <div className="flex flex-wrap gap-2">
      <LinkButton
        render={<Link href={episodePath} />}
        variant={current === "basic" ? "default" : "outline"}
      >
        <Message message="admin.series.episodes.basic_tab" />
      </LinkButton>
      <LinkButton
        render={<Link href={`${episodePath}?tab=eye-catch`} />}
        variant={current === "eye-catch" ? "default" : "outline"}
      >
        <Message message="admin.series.episodes.eye_catch_tab" />
      </LinkButton>
    </div>
  );
};
