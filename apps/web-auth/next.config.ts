import { withMicrofrontends } from "@publira/next-config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  output: "standalone",
};

export default withMicrofrontends(nextConfig, { appName: "web-auth" });
