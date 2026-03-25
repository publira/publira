import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { PlatformAuditLogService } from "../gen/publira/platform/v1/audit_pb.js";
import { PlatformAuthService } from "../gen/publira/platform/v1/auth_pb.js";
import { PlatformOperatorService } from "../gen/publira/platform/v1/operator_pb.js";
import { PlatformSetupService } from "../gen/publira/platform/v1/setup_pb.js";
import { PlatformTenantService } from "../gen/publira/platform/v1/tenant_pb.js";
import { PlatformUserService } from "../gen/publira/platform/v1/user_pb.js";

export type TransportType = "connect" | "grpc";

export type PlatformApiClientOptions = {
  baseUrl: string;
  transport?: TransportType;
} & Omit<ConnectTransportOptions, "baseUrl">;

export interface PlatformApiClient {
  auth: Client<typeof PlatformAuthService>;
  auditLogs: Client<typeof PlatformAuditLogService>;
  operators: Client<typeof PlatformOperatorService>;
  setup: Client<typeof PlatformSetupService>;
  tenants: Client<typeof PlatformTenantService>;
  users: Client<typeof PlatformUserService>;
}

export const createPlatformApiClient = (
  options: PlatformApiClientOptions
): PlatformApiClient => {
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
    auditLogs: createClient(PlatformAuditLogService, transportInstance),
    auth: createClient(PlatformAuthService, transportInstance),
    operators: createClient(PlatformOperatorService, transportInstance),
    setup: createClient(PlatformSetupService, transportInstance),
    tenants: createClient(PlatformTenantService, transportInstance),
    users: createClient(PlatformUserService, transportInstance),
  };
};
