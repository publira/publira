import { cacheTag } from "next/cache";

export const tenantPublicSiteTag = (tenantPublicId: string) =>
  `tenant:${tenantPublicId.trim()}:public:site`;

export const applyCacheTag = (tag: string) => {
  try {
    cacheTag(tag);
  } catch {
    // Some unit tests run without Next cacheComponents runtime support.
  }
};
