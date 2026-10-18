import type { EyeCatchVariantItem } from "#components/eye-catch/types";

/** One banner as the console shows it, in the order the tenant put them in. */
export interface CampaignBannerListItem {
  /** The primary key every banner write addresses the banner by. */
  id: string;
  /** What the banner's edit screen is addressed by in the URL. */
  publicId: string;
  linkUrl: string;
  startsAt: string;
  endsAt: string;
  published: boolean;
  imageUpdatedAt: string;
  imageVariants: EyeCatchVariantItem[];
}

/** Result of a reorder, which the list submits rather than a form. */
export interface CampaignBannerReorderResult {
  ok: boolean;
  message?: string;
}
