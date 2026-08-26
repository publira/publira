import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import type { ReactNode } from "react";

interface SettingsTabNavProps {
  current: "email" | "general";
  emailLabel: ReactNode;
  generalLabel: ReactNode;
}

export const SettingsTabNav = ({
  current,
  emailLabel,
  generalLabel,
}: SettingsTabNavProps) => (
  <div className="flex flex-wrap gap-2">
    <LinkButton
      render={<Link href="/settings/general" />}
      variant={current === "general" ? "default" : "outline"}
    >
      {generalLabel}
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/email" />}
      variant={current === "email" ? "default" : "outline"}
    >
      {emailLabel}
    </LinkButton>
  </div>
);
