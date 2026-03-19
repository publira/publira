import type { NextConfig } from "next";

export interface WithMicrofrontendsOptions {
  appName: string;
}

/**
 * Microfrontends用の共通Next.js設定ラッパー
 * @param nextConfig - 既存のNext.js設定
 * @param opts - マイクロフロントエンド設定
 * @returns Next.js設定
 */
export const withMicrofrontends = (
  nextConfig: NextConfig,
  opts: WithMicrofrontendsOptions
): NextConfig => {
  const normalizedAppName = String(opts?.appName || "")
    .trim()
    .replaceAll(/^\/+|\/+$/g, "");
  if (!normalizedAppName) {
    throw new Error("withMicrofrontends: opts.appName is required");
  }

  const assetPrefix = nextConfig.assetPrefix ?? `/${normalizedAppName}-assets`;

  return {
    ...nextConfig,
    assetPrefix,
    images: {
      ...nextConfig.images,
      path: nextConfig.images?.path ?? `${assetPrefix}/_next/image`,
    },
    async rewrites() {
      const existingRewrites = nextConfig.rewrites
        ? await nextConfig.rewrites()
        : [];

      const mfeRewrites = [
        {
          destination: "/_next/:path+",
          source: `${assetPrefix}/_next/:path+`,
        },
      ];

      if (Array.isArray(existingRewrites)) {
        return [...mfeRewrites, ...existingRewrites];
      }

      return {
        ...existingRewrites,
        beforeFiles: [...mfeRewrites, ...(existingRewrites.beforeFiles || [])],
      };
    },
  };
};
