"use client";

import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

import { useAdminMessage } from "#components/client-message";

interface SeriesTabNavProps {
  current: "basic" | "eye-catch";
  seriesId: string;
}

export const SeriesTabNav = ({ current, seriesId }: SeriesTabNavProps) => {
  const t = useAdminMessage();

  return (
    <div className="flex flex-wrap gap-2">
      <LinkButton
        render={<Link href={`/series/${seriesId}`} />}
        variant={current === "basic" ? "default" : "outline"}
      >
        {t("admin.series.basic_tab")}
      </LinkButton>
      <LinkButton
        render={<Link href={`/series/${seriesId}?tab=eye-catch`} />}
        variant={current === "eye-catch" ? "default" : "outline"}
      >
        {t("admin.series.eye_catch_tab")}
      </LinkButton>
    </div>
  );
};
