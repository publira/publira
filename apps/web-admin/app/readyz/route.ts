import { checkRedisReady } from "@publira/next-cache-handlers";
import {
  checkUpstreamReadyz,
  createReadyzResponse,
} from "@publira/utils/health";
import type { HealthCheck } from "@publira/utils/health";
import { connection } from "next/server";

const apiBaseUrl = process.env.PUBLIRA_GRPC_URL ?? "http://localhost:8000/rpc";
const publicApiBaseUrl = process.env.PUBLIRA_PUBLIC_GRPC_URL;

const checks: HealthCheck[] = [
  {
    check: (signal) => checkUpstreamReadyz(apiBaseUrl, signal),
    name: "api",
  },
  // Without a URL of its own, the public API is on the server `api` checks.
  ...(publicApiBaseUrl === undefined
    ? []
    : [
        {
          check: (signal: AbortSignal) =>
            checkUpstreamReadyz(publicApiBaseUrl, signal),
          name: "public-api",
        },
      ]),
  {
    check: () => checkRedisReady(),
    name: "redis",
  },
];

// connection() keeps `next build` from prerendering this handler and running the checks.
export const GET = async () => {
  await connection();
  return createReadyzResponse(checks);
};
