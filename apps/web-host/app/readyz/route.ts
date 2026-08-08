import { checkRedisReady } from "@publira/next-cache-handlers";
import {
  checkUpstreamReadyz,
  createReadyzResponse,
} from "@publira/utils/health";
import type { HealthCheck } from "@publira/utils/health";

const publicApiBaseUrl =
  process.env.PUBLIRA_PUBLIC_GRPC_URL ?? "http://localhost:8100";

const checks: HealthCheck[] = [
  {
    check: (signal) => checkUpstreamReadyz(publicApiBaseUrl, signal),
    name: "api",
  },
  {
    check: () => checkRedisReady(),
    name: "redis",
  },
];

export const GET = () => createReadyzResponse(checks);
