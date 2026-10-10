import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { PlatformAuditLogService } from "../gen/publira/platform/v1/audit_pb.js";
import { PlatformAuthService } from "../gen/publira/platform/v1/auth_pb.js";
import { PlatformDashboardService } from "../gen/publira/platform/v1/dashboard_pb.js";
import { PlatformEmailSettingsService } from "../gen/publira/platform/v1/email_pb.js";
import { PlatformNotificationService } from "../gen/publira/platform/v1/notification_pb.js";
import { PlatformOperatorService } from "../gen/publira/platform/v1/operator_pb.js";
import { PlatformPolicyService } from "../gen/publira/platform/v1/policy_pb.js";
import { PlatformSearchSettingsService } from "../gen/publira/platform/v1/search_pb.js";
import { PlatformSettingsService } from "../gen/publira/platform/v1/settings_pb.js";
import { PlatformSetupService } from "../gen/publira/platform/v1/setup_pb.js";
import { PlatformStorageSettingsService } from "../gen/publira/platform/v1/storage_pb.js";
import { PlatformTenantService } from "../gen/publira/platform/v1/tenant_pb.js";
import { PlatformUserService } from "../gen/publira/platform/v1/user_pb.js";
import { PlatformWebPushSettingsService } from "../gen/publira/platform/v1/webpush_pb.js";
import { createApiGrpcTransport } from "../grpc-session.js";
import { createTenantHeaderInterceptor } from "../tenant-header.js";
import type { TenantHeaderOptions } from "../tenant-header.js";
import { createTracingInterceptor } from "../tracing.js";
import type { TransportType } from "../transport-type.js";

export type { TransportType } from "../transport-type.js";

export type PlatformApiClientOptions = {
  baseUrl: string;
  transport?: TransportType;
} & Omit<ConnectTransportOptions, "baseUrl"> &
  TenantHeaderOptions;

export interface PlatformApiClient {
  auth: Client<typeof PlatformAuthService>;
  auditLogs: Client<typeof PlatformAuditLogService>;
  dashboard: Client<typeof PlatformDashboardService>;
  emailSettings: Client<typeof PlatformEmailSettingsService>;
  notification: Client<typeof PlatformNotificationService>;
  operators: Client<typeof PlatformOperatorService>;
  policy: Client<typeof PlatformPolicyService>;
  searchSettings: Client<typeof PlatformSearchSettingsService>;
  settings: Client<typeof PlatformSettingsService>;
  setup: Client<typeof PlatformSetupService>;
  storageSettings: Client<typeof PlatformStorageSettingsService>;
  tenants: Client<typeof PlatformTenantService>;
  users: Client<typeof PlatformUserService>;
  webPushSettings: Client<typeof PlatformWebPushSettingsService>;
}

export const createPlatformApiClient = (
  options: PlatformApiClientOptions
): PlatformApiClient => {
  const {
    baseUrl,
    tenantId,
    transport = "connect",
    ...transportOptions
  } = options;

  const tenantHeaderInterceptor = createTenantHeaderInterceptor({
    tenantId,
  });
  const interceptors = [
    createTracingInterceptor(transport),
    ...(tenantHeaderInterceptor ? [tenantHeaderInterceptor] : []),
    ...(transportOptions.interceptors ?? []),
  ];

  const transportInstance =
    transport === "grpc"
      ? createApiGrpcTransport({
          baseUrl,
          ...transportOptions,
          interceptors,
        })
      : createConnectTransport({
          baseUrl,
          ...transportOptions,
          interceptors,
        });

  return {
    auditLogs: createClient(PlatformAuditLogService, transportInstance),
    auth: createClient(PlatformAuthService, transportInstance),
    dashboard: createClient(PlatformDashboardService, transportInstance),
    emailSettings: createClient(
      PlatformEmailSettingsService,
      transportInstance
    ),
    notification: createClient(PlatformNotificationService, transportInstance),
    operators: createClient(PlatformOperatorService, transportInstance),
    policy: createClient(PlatformPolicyService, transportInstance),
    searchSettings: createClient(
      PlatformSearchSettingsService,
      transportInstance
    ),
    settings: createClient(PlatformSettingsService, transportInstance),
    setup: createClient(PlatformSetupService, transportInstance),
    storageSettings: createClient(
      PlatformStorageSettingsService,
      transportInstance
    ),
    tenants: createClient(PlatformTenantService, transportInstance),
    users: createClient(PlatformUserService, transportInstance),
    webPushSettings: createClient(
      PlatformWebPushSettingsService,
      transportInstance
    ),
  };
};
