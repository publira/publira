import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { AdminAuthService } from "../gen/publira/admin/v1/auth_pb.js";
import { AdminSeriesService } from "../gen/publira/admin/v1/series_pb.js";
import { TenantThemeService } from "../gen/publira/admin/v1/theme_pb.js";

export type TransportType = "connect" | "grpc";

export type AdminApiClientOptions = {
  baseUrl: string;
  transport?: TransportType;
} & Omit<ConnectTransportOptions, "baseUrl">;

export interface AdminApiClient {
  auth: Client<typeof AdminAuthService>;
  series: Client<typeof AdminSeriesService>;
  theme: Client<typeof TenantThemeService>;
}

export const createAdminApiClient = (
  options: AdminApiClientOptions
): AdminApiClient => {
  const { baseUrl, transport = "connect", ...transportOptions } = options;

  const transportInstance =
    transport === "grpc"
      ? createGrpcTransport({
          baseUrl,
          ...transportOptions,
        })
      : createConnectTransport({
          baseUrl,
          ...transportOptions,
        });

  return {
    auth: createClient(AdminAuthService, transportInstance),
    series: createClient(AdminSeriesService, transportInstance),
    theme: createClient(TenantThemeService, transportInstance),
  };
};
