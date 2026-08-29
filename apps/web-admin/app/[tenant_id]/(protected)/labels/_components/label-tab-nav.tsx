"use client";

import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

import { useAdminMessage } from "#components/client-message";

interface LabelTabNavProps {
  current: "basic" | "eye-catch";
  labelId: string;
}

export const LabelTabNav = ({ current, labelId }: LabelTabNavProps) => {
  const t = useAdminMessage();

  return (
    <div className="flex flex-wrap gap-2">
      <LinkButton
        render={<Link href={`/labels/${labelId}`} />}
        variant={current === "basic" ? "default" : "outline"}
      >
        {t("admin.labels.basic_tab")}
      </LinkButton>
      <LinkButton
        render={<Link href={`/labels/${labelId}?tab=eye-catch`} />}
        variant={current === "eye-catch" ? "default" : "outline"}
      >
        {t("admin.labels.eye_catch_tab")}
      </LinkButton>
    </div>
  );
};
