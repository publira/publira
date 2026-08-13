import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

interface SettingsTabNavProps {
  current: "account" | "email" | "general";
}

export const SettingsTabNav = ({ current }: SettingsTabNavProps) => (
  <div className="flex items-center gap-2">
    <div className="flex flex-wrap gap-2">
      <LinkButton
        render={<Link href="/settings/general" />}
        variant={current === "general" ? "default" : "outline"}
      >
        一般
      </LinkButton>
      <LinkButton
        render={<Link href="/settings/email" />}
        variant={current === "email" ? "default" : "outline"}
      >
        メール設定
      </LinkButton>
    </div>

    <div className="ml-auto flex items-center gap-2">
      <div className="h-6 border-l border-border" />
      <LinkButton
        render={<Link href="/settings/account" />}
        variant={current === "account" ? "default" : "outline"}
      >
        アカウント
      </LinkButton>
    </div>
  </div>
);
