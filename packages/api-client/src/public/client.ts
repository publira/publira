import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { AuthService } from "../gen/publira/v1/auth_pb.js";
import { CatalogService } from "../gen/publira/v1/catalog_pb.js";

export type PublicApiClientOptions = {
  baseUrl: string;
} & Omit<ConnectTransportOptions, "baseUrl">;

export interface PublicApiClient {
  auth: Client<typeof AuthService>;
  catalog: Client<typeof CatalogService>;
}

export const createPublicApiClient = (
  options: PublicApiClientOptions
): PublicApiClient => {
  const { baseUrl, ...transportOptions } = options;
  const transport = createConnectTransport({
    baseUrl,
    ...transportOptions,
  });

  return {
    auth: createClient(AuthService, transport),
    catalog: createClient(CatalogService, transport),
  };
};
