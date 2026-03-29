import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

interface SettingsTabNavProps {
  current: "email";
}

export const SettingsTabNav = ({ current }: SettingsTabNavProps) => (
  <div className="flex flex-wrap gap-2">
    <LinkButton
      render={<Link href="/settings/email" />}
      variant={current === "email" ? "default" : "outline"}
    >
      メール設定
    </LinkButton>
  </div>
);
