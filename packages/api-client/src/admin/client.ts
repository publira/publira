import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { AdminAuthService } from "../gen/publira/admin/v1/auth_pb.js";
import { AdminSeriesService } from "../gen/publira/admin/v1/series_pb.js";
import { TenantThemeService } from "../gen/publira/admin/v1/theme_pb.js";

export type AdminApiClientOptions = {
  baseUrl: string;
} & Omit<ConnectTransportOptions, "baseUrl">;

export interface AdminApiClient {
  auth: Client<typeof AdminAuthService>;
  series: Client<typeof AdminSeriesService>;
  theme: Client<typeof TenantThemeService>;
}

export const createAdminApiClient = (
  options: AdminApiClientOptions
): AdminApiClient => {
  const { baseUrl, ...transportOptions } = options;
  const transport = createConnectTransport({
    baseUrl,
    ...transportOptions,
  });

  return {
    auth: createClient(AdminAuthService, transport),
    series: createClient(AdminSeriesService, transport),
    theme: createClient(TenantThemeService, transport),
  };
};
