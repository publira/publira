/**
 * Records created by `db/seeds/scenarios/580_storefront_google_tag.sql`.
 * Re-applying it deletes the tenant's stored Google tag settings, which leaves
 * it loading no tag.
 */

export const STOREFRONT_GOOGLE_TAG_SCENARIO = "580_storefront_google_tag";

/** Tenant whose site the storefront Google tag suite opens. */
export const STOREFRONT_GOOGLE_TAG_TENANT = {
  domain: "measure.localhost",
  id: "018f1120-0001-7000-8000-000000000001",
  name: "Measured Tenant",
  publicId: "MsrdTNNTAAA1",
} as const;

/** Reader of that tenant. Password hash is the same as `memberpass`. */
export const STOREFRONT_GOOGLE_TAG_READER = {
  email: "measure-reader@example.com",
  password: "memberpass",
  publicId: "MsrdMMBRAAA1",
} as const;
