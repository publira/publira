import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

interface SettingsTabNavProps {
  current: "basic" | "email" | "payment" | "theme";
}

export const SettingsTabNav = ({ current }: SettingsTabNavProps) => (
  <div className="flex flex-wrap gap-2">
    <LinkButton
      render={<Link href="/settings" />}
      variant={current === "basic" ? "default" : "outline"}
    >
      基本情報
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/theme" />}
      variant={current === "theme" ? "default" : "outline"}
    >
      テーマ
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/email" />}
      variant={current === "email" ? "default" : "outline"}
    >
      メール情報
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/payment" />}
      variant={current === "payment" ? "default" : "outline"}
    >
      決済
    </LinkButton>
  </div>
);
