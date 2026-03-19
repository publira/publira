import { withMicrofrontends } from "@publira/next-config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

export default withMicrofrontends(nextConfig, { appName: "web-member" });
