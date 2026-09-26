import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { ComponentProps } from "react";
import { Suspense } from "react";

import { Message } from "#components/message";

import { SettingsTabNav } from "./settings-tab-nav";

export const SettingsNavigation = ({
  current,
}: {
  current: ComponentProps<typeof SettingsTabNav>["current"];
}) => (
  <SettingsTabNav
    communityLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
        <Message message="platform.policy.community.tab" />
      </Suspense>
    }
    current={current}
    emailLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <Message message="platform.settings.email_tab" />
      </Suspense>
    }
    generalLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
        <Message message="platform.settings.general_tab" />
      </Suspense>
    }
    overviewLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="platform.configuration.tab" />
      </Suspense>
    }
    retentionLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="platform.policy.retention.tab" />
      </Suspense>
    }
    securityLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
        <Message message="platform.policy.security.tab" />
      </Suspense>
    }
    storageLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
        <Message message="platform.storage.tab" />
      </Suspense>
    }
    webPushLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="platform.webpush.tab" />
      </Suspense>
    }
  />
);
