import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import type { ReactNode } from "react";

interface SettingsTabNavProps {
  communityLabel: ReactNode;
  current:
    | "community"
    | "email"
    | "general"
    | "retention"
    | "security"
    | "storage"
    | "webpush";
  emailLabel: ReactNode;
  generalLabel: ReactNode;
  retentionLabel: ReactNode;
  securityLabel: ReactNode;
  storageLabel: ReactNode;
  webPushLabel: ReactNode;
}

export const SettingsTabNav = ({
  communityLabel,
  current,
  emailLabel,
  generalLabel,
  retentionLabel,
  securityLabel,
  storageLabel,
  webPushLabel,
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
    <LinkButton
      render={<Link href="/settings/storage" />}
      variant={current === "storage" ? "default" : "outline"}
    >
      {storageLabel}
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/webpush" />}
      variant={current === "webpush" ? "default" : "outline"}
    >
      {webPushLabel}
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/security" />}
      variant={current === "security" ? "default" : "outline"}
    >
      {securityLabel}
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/community" />}
      variant={current === "community" ? "default" : "outline"}
    >
      {communityLabel}
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/retention" />}
      variant={current === "retention" ? "default" : "outline"}
    >
      {retentionLabel}
    </LinkButton>
  </div>
);
