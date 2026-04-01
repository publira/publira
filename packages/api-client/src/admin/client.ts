import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { AdminAuditLogService } from "../gen/publira/admin/v1/audit_pb.js";
import { AdminAuthService } from "../gen/publira/admin/v1/auth_pb.js";
import { AdminCreatorService } from "../gen/publira/admin/v1/creator_pb.js";
import { AdminDashboardService } from "../gen/publira/admin/v1/dashboard_pb.js";
import { AdminEmailSettingsService } from "../gen/publira/admin/v1/email_pb.js";
import { AdminLabelService } from "../gen/publira/admin/v1/label_pb.js";
import { AdminSeriesService } from "../gen/publira/admin/v1/series_pb.js";
import { TenantThemeService } from "../gen/publira/admin/v1/theme_pb.js";
import { AdminUserService } from "../gen/publira/admin/v1/user_pb.js";
import { createTenantHeaderInterceptor } from "../tenant-header.js";
import type { TenantHeaderOptions } from "../tenant-header.js";

export type TransportType = "connect" | "grpc";

export type AdminApiClientOptions = {
  baseUrl: string;
  transport?: TransportType;
} & Omit<ConnectTransportOptions, "baseUrl"> &
  TenantHeaderOptions;

export interface AdminApiClient {
  audit: Client<typeof AdminAuditLogService>;
  auth: Client<typeof AdminAuthService>;
  creator: Client<typeof AdminCreatorService>;
  dashboard: Client<typeof AdminDashboardService>;
  emailSettings: Client<typeof AdminEmailSettingsService>;
  label: Client<typeof AdminLabelService>;
  series: Client<typeof AdminSeriesService>;
  theme: Client<typeof TenantThemeService>;
  users: Client<typeof AdminUserService>;
}

export const createAdminApiClient = (
  options: AdminApiClientOptions
): AdminApiClient => {
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
    audit: createClient(AdminAuditLogService, transportInstance),
    auth: createClient(AdminAuthService, transportInstance),
    creator: createClient(AdminCreatorService, transportInstance),
    dashboard: createClient(AdminDashboardService, transportInstance),
    emailSettings: createClient(AdminEmailSettingsService, transportInstance),
    label: createClient(AdminLabelService, transportInstance),
    series: createClient(AdminSeriesService, transportInstance),
    theme: createClient(TenantThemeService, transportInstance),
    users: createClient(AdminUserService, transportInstance),
  };
};
