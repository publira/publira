import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { PlatformAuditLogService } from "../gen/publira/platform/v1/audit_pb.js";
import { PlatformAuthService } from "../gen/publira/platform/v1/auth_pb.js";
import { PlatformDashboardService } from "../gen/publira/platform/v1/dashboard_pb.js";
import { PlatformEmailSettingsService } from "../gen/publira/platform/v1/email_pb.js";
import { PlatformOperatorService } from "../gen/publira/platform/v1/operator_pb.js";
import { PlatformSettingsService } from "../gen/publira/platform/v1/settings_pb.js";
import { PlatformSetupService } from "../gen/publira/platform/v1/setup_pb.js";
import { PlatformTenantService } from "../gen/publira/platform/v1/tenant_pb.js";
import { PlatformUserService } from "../gen/publira/platform/v1/user_pb.js";
import { createTenantHeaderInterceptor } from "../tenant-header.js";
import type { TenantHeaderOptions } from "../tenant-header.js";

export type TransportType = "connect" | "grpc";

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
  operators: Client<typeof PlatformOperatorService>;
  settings: Client<typeof PlatformSettingsService>;
  setup: Client<typeof PlatformSetupService>;
  tenants: Client<typeof PlatformTenantService>;
  users: Client<typeof PlatformUserService>;
}

export const createPlatformApiClient = (
  options: PlatformApiClientOptions
): PlatformApiClient => {
  const {
    baseUrl,
    transport = "connect",
    tenantPublicId,
    ...transportOptions
  } = options;

  const tenantHeaderInterceptor = createTenantHeaderInterceptor({
    tenantPublicId,
  });
  const interceptors = [
    ...(tenantHeaderInterceptor ? [tenantHeaderInterceptor] : []),
    ...(transportOptions.interceptors ?? []),
  ];

  const transportInstance =
    transport === "grpc"
      ? createGrpcTransport({
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
    operators: createClient(PlatformOperatorService, transportInstance),
    settings: createClient(PlatformSettingsService, transportInstance),
    setup: createClient(PlatformSetupService, transportInstance),
    tenants: createClient(PlatformTenantService, transportInstance),
    users: createClient(PlatformUserService, transportInstance),
  };
};
