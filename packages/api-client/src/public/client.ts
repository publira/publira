import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { AuthService } from "../gen/publira/v1/auth_pb.js";
import { CatalogService } from "../gen/publira/v1/catalog_pb.js";
import { TenantService } from "../gen/publira/v1/tenant_pb.js";
import { DomainService } from "../gen/publira/v1/domain_pb.js";

export type TransportType = "connect" | "grpc";

export type PublicApiClientOptions = {
  baseUrl: string;
  transport?: TransportType;
} & Omit<ConnectTransportOptions, "baseUrl">;

export interface PublicApiClient {
  auth: Client<typeof AuthService>;
  catalog: Client<typeof CatalogService>;
  tenant: Client<typeof TenantService>;
  domain: Client<typeof DomainService>;
}

export const createPublicApiClient = (
  options: PublicApiClientOptions
): PublicApiClient => {
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
    auth: createClient(AuthService, transportInstance),
    catalog: createClient(CatalogService, transportInstance),
    domain: createClient(DomainService, transportInstance),
    tenant: createClient(TenantService, transportInstance),
  };
};
