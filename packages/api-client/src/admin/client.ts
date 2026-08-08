import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { AdminAccessTicketService } from "../gen/publira/admin/v1/access_ticket_pb.js";
import { AdminAuditLogService } from "../gen/publira/admin/v1/audit_pb.js";
import { AdminAuthService } from "../gen/publira/admin/v1/auth_pb.js";
import { AdminCreatorService } from "../gen/publira/admin/v1/creator_pb.js";
import { AdminDashboardService } from "../gen/publira/admin/v1/dashboard_pb.js";
import { AdminEmailSettingsService } from "../gen/publira/admin/v1/email_pb.js";
import { AdminLabelService } from "../gen/publira/admin/v1/label_pb.js";
import { AdminNotificationService } from "../gen/publira/admin/v1/notification_pb.js";
import { AdminPagesService } from "../gen/publira/admin/v1/page_pb.js";
import { AdminSeriesService } from "../gen/publira/admin/v1/series_pb.js";
import { TenantSettingsService } from "../gen/publira/admin/v1/tenant_pb.js";
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
  accessTickets: Client<typeof AdminAccessTicketService>;
  audit: Client<typeof AdminAuditLogService>;
  auth: Client<typeof AdminAuthService>;
  creator: Client<typeof AdminCreatorService>;
  dashboard: Client<typeof AdminDashboardService>;
  emailSettings: Client<typeof AdminEmailSettingsService>;
  label: Client<typeof AdminLabelService>;
  notification: Client<typeof AdminNotificationService>;
  pages: Client<typeof AdminPagesService>;
  series: Client<typeof AdminSeriesService>;
  tenantSettings: Client<typeof TenantSettingsService>;
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
    accessTickets: createClient(AdminAccessTicketService, transportInstance),
    audit: createClient(AdminAuditLogService, transportInstance),
    auth: createClient(AdminAuthService, transportInstance),
    creator: createClient(AdminCreatorService, transportInstance),
    dashboard: createClient(AdminDashboardService, transportInstance),
    emailSettings: createClient(AdminEmailSettingsService, transportInstance),
    label: createClient(AdminLabelService, transportInstance),
    notification: createClient(AdminNotificationService, transportInstance),
    pages: createClient(AdminPagesService, transportInstance),
    series: createClient(AdminSeriesService, transportInstance),
    tenantSettings: createClient(TenantSettingsService, transportInstance),
    theme: createClient(TenantThemeService, transportInstance),
    users: createClient(AdminUserService, transportInstance),
  };
};
