import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

interface SeriesTabNavProps {
  current: "basic" | "eye-catch";
  seriesId: string;
}

export const SeriesTabNav = ({ current, seriesId }: SeriesTabNavProps) => (
  <div className="flex flex-wrap gap-2">
    <LinkButton
      render={<Link href={`/series/${seriesId}`} />}
      variant={current === "basic" ? "default" : "outline"}
    >
      基本情報
    </LinkButton>
    <LinkButton
      render={<Link href={`/series/${seriesId}?tab=eye-catch`} />}
      variant={current === "eye-catch" ? "default" : "outline"}
    >
      アイキャッチ
    </LinkButton>
  </div>
);
