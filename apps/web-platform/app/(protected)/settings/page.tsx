import { getLocaleLabel } from "@publira/i18n";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformPage,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import {
  emailConfigurationState,
  getRequiredConfigurationState,
  policyConfigurationState,
  storageConfigurationState,
  webPushConfigurationState,
} from "#lib/configuration-status";
import { getPlatformEmailSettings } from "#lib/email-settings";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  getPlatformPolicy,
  getPlatformRetentionDefaults,
} from "#lib/platform-policy";
import { getPlatformSettings } from "#lib/platform-settings";
import { getPlatformStorageSettings } from "#lib/storage-settings";
import { getPlatformWebPushSettings } from "#lib/webpush-settings";

import {
  ConfigurationAction,
  ConfigurationRow,
  ConfigurationRowSkeleton,
  ConfigurationStatusBadge,
} from "./_components/configuration-status";
import { SettingsNavigation } from "./_components/settings-navigation";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);
  return { title: t("platform.configuration.page_title") };
};

const RequiredNecessity = () => (
  <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
    <Message message="platform.configuration.necessity.required" />
  </Suspense>
);

const OptionalNecessity = () => (
  <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
    <Message message="platform.configuration.necessity.optional" />
  </Suspense>
);

/** Silent when a read failed, since the row that failed already says so. */
const ConfigurationSummary = async () => {
  const locale = await getPlatformLocale();
  const state = await getRequiredConfigurationState(locale);

  switch (state) {
    case "needs_setup": {
      return (
        <FormMessage variant="warning">
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="platform.configuration.summary_needs_setup" />
          </Suspense>
        </FormMessage>
      );
    }
    case "ready": {
      return (
        <FormMessage variant="success">
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="platform.configuration.summary_ready" />
          </Suspense>
        </FormMessage>
      );
    }
    default: {
      return null;
    }
  }
};

const GeneralRow = async () => {
  const locale = await getPlatformLocale();
  const result = await getPlatformSettings(locale);
  await redirectToLoginIfSessionRejected(result);

  const name = (
    <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
      <Message message="platform.configuration.general.name" />
    </Suspense>
  );

  if (!result.ok) {
    return (
      <ConfigurationRow
        action={
          <ConfigurationAction href="/settings/general" state="unavailable" />
        }
        details={result.message}
        name={name}
        necessity={<RequiredNecessity />}
        status={<ConfigurationStatusBadge state="unavailable" />}
      />
    );
  }

  return (
    <ConfigurationRow
      action={
        <ConfigurationAction href="/settings/general" state="configured" />
      }
      details={
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message
            message="platform.configuration.general.detail"
            values={{
              language: getLocaleLabel(result.defaultLocale),
              time_zone: result.defaultTimezone,
            }}
          />
        </Suspense>
      }
      name={name}
      necessity={<RequiredNecessity />}
      status={<ConfigurationStatusBadge state="configured" />}
    />
  );
};

const EmailRow = async () => {
  const locale = await getPlatformLocale();
  const result = await getPlatformEmailSettings(locale);
  await redirectToLoginIfSessionRejected(result);

  const name = (
    <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
      <Message message="platform.configuration.email.name" />
    </Suspense>
  );

  if (!result.ok) {
    return (
      <ConfigurationRow
        action={
          <ConfigurationAction href="/settings/email" state="unavailable" />
        }
        details={result.message}
        name={name}
        necessity={<RequiredNecessity />}
        status={<ConfigurationStatusBadge state="unavailable" />}
      />
    );
  }

  const { settings } = result;
  const state = emailConfigurationState(settings);
  let details = (
    <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
      <Message
        message="platform.configuration.email.configured"
        values={{ from_address: settings.fromAddress }}
      />
    </Suspense>
  );
  if (state === "needs_setup") {
    details = settings.host.trim() ? (
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="platform.configuration.email.password_missing" />
      </Suspense>
    ) : (
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="platform.configuration.email.unconfigured" />
      </Suspense>
    );
  }

  return (
    <ConfigurationRow
      action={<ConfigurationAction href="/settings/email" state={state} />}
      details={details}
      name={name}
      necessity={<RequiredNecessity />}
      status={<ConfigurationStatusBadge state={state} />}
    />
  );
};

const StorageRow = async () => {
  const locale = await getPlatformLocale();
  const result = await getPlatformStorageSettings(locale);
  await redirectToLoginIfSessionRejected(result);

  const name = (
    <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
      <Message message="platform.configuration.storage.name" />
    </Suspense>
  );

  if (!result.ok) {
    return (
      <ConfigurationRow
        action={
          <ConfigurationAction href="/settings/storage" state="unavailable" />
        }
        details={result.message}
        name={name}
        necessity={<RequiredNecessity />}
        status={<ConfigurationStatusBadge state="unavailable" />}
      />
    );
  }

  const state = storageConfigurationState(result.settings);

  return (
    <ConfigurationRow
      action={<ConfigurationAction href="/settings/storage" state={state} />}
      details={
        state === "configured" ? (
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message
              message="platform.configuration.storage.configured"
              values={{ bucket: result.settings.bucket }}
            />
          </Suspense>
        ) : (
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.configuration.storage.unconfigured" />
          </Suspense>
        )
      }
      name={name}
      necessity={<RequiredNecessity />}
      status={<ConfigurationStatusBadge state={state} />}
    />
  );
};

const WebPushRow = async () => {
  const locale = await getPlatformLocale();
  const result = await getPlatformWebPushSettings(locale);
  await redirectToLoginIfSessionRejected(result);

  const name = (
    <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
      <Message message="platform.configuration.webpush.name" />
    </Suspense>
  );

  if (!result.ok) {
    return (
      <ConfigurationRow
        action={
          <ConfigurationAction href="/settings/webpush" state="unavailable" />
        }
        details={result.message}
        name={name}
        necessity={<OptionalNecessity />}
        status={<ConfigurationStatusBadge state="unavailable" />}
      />
    );
  }

  const state = webPushConfigurationState(result.settings);

  return (
    <ConfigurationRow
      action={<ConfigurationAction href="/settings/webpush" state={state} />}
      details={
        state === "configured" ? (
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.configuration.webpush.configured" />
          </Suspense>
        ) : (
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.configuration.webpush.unconfigured" />
          </Suspense>
        )
      }
      name={name}
      necessity={<OptionalNecessity />}
      status={<ConfigurationStatusBadge state={state} />}
    />
  );
};

const PoliciesRow = async () => {
  const locale = await getPlatformLocale();
  const [policy, retention] = await Promise.all([
    getPlatformPolicy(locale),
    getPlatformRetentionDefaults(locale),
  ]);
  await redirectToLoginIfSessionRejected(policy, retention);

  const name = (
    <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
      <Message message="platform.configuration.policies.name" />
    </Suspense>
  );

  if (!(policy.ok && retention.ok)) {
    const failure = policy.ok ? retention : policy;
    return (
      <ConfigurationRow
        action={
          <ConfigurationAction href="/settings/security" state="unavailable" />
        }
        details={failure.ok ? null : failure.message}
        name={name}
        necessity={<OptionalNecessity />}
        status={<ConfigurationStatusBadge state="unavailable" />}
      />
    );
  }

  const state = policyConfigurationState([policy.revision, retention.revision]);

  return (
    <ConfigurationRow
      action={<ConfigurationAction href="/settings/security" state={state} />}
      details={
        state === "defaults" ? (
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.configuration.policies.defaults" />
          </Suspense>
        ) : (
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.configuration.policies.configured" />
          </Suspense>
        )
      }
      name={name}
      necessity={<OptionalNecessity />}
      status={<ConfigurationStatusBadge state={state} />}
    />
  );
};

const PlatformConfigurationPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-16" />}>
            <Message message="platform.configuration.heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="platform.configuration.page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <div className="grid gap-6">
        <SettingsNavigation current="overview" />
        <Suspense fallback={<Skeleton className="h-9 w-full" />}>
          <ConfigurationSummary />
        </Suspense>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="platform.configuration.columns.setting" />
                </Suspense>
              </TableHead>
              <TableHead className="w-36">
                <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                  <Message message="platform.configuration.columns.status" />
                </Suspense>
              </TableHead>
              <TableHead>
                <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                  <Message message="platform.configuration.columns.details" />
                </Suspense>
              </TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <Suspense fallback={<ConfigurationRowSkeleton />}>
              <GeneralRow />
            </Suspense>
            <Suspense fallback={<ConfigurationRowSkeleton />}>
              <EmailRow />
            </Suspense>
            <Suspense fallback={<ConfigurationRowSkeleton />}>
              <StorageRow />
            </Suspense>
            <Suspense fallback={<ConfigurationRowSkeleton />}>
              <WebPushRow />
            </Suspense>
            <Suspense fallback={<ConfigurationRowSkeleton />}>
              <PoliciesRow />
            </Suspense>
          </TableBody>
        </Table>
      </div>
    </PlatformPageContent>
  </PlatformPage>
);

export default PlatformConfigurationPage;
