import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { SettingsTabNav } from "./settings-tab-nav";

const label = (
  message:
    | "platform.policy.community.tab"
    | "platform.policy.retention.tab"
    | "platform.policy.security.tab"
    | "platform.settings.email_tab"
    | "platform.settings.general_tab",
  fallbackClassName: string
) => (
  <Suspense fallback={<SkeletonLine className={fallbackClassName} />}>
    <Message message={message} />
  </Suspense>
);

export const SettingsNavigation = ({
  current,
}: {
  current: "community" | "email" | "general" | "retention" | "security";
}) => (
  <SettingsTabNav
    communityLabel={label("platform.policy.community.tab", "h-4 w-20")}
    current={current}
    emailLabel={label("platform.settings.email_tab", "h-4 w-12")}
    generalLabel={label("platform.settings.general_tab", "h-4 w-14")}
    retentionLabel={label("platform.policy.retention.tab", "h-4 w-16")}
    securityLabel={label("platform.policy.security.tab", "h-4 w-14")}
  />
);
