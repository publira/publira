export * from "../gen/publira/types/v1/types_pb.js";

// Admin.v1 entity messages, so mappers can Pick them the same way as
// types.v1. Request/response wrappers stay on the per-service modules.
export type { AdminAccessTicket } from "../gen/publira/admin/v1/access_ticket_pb.js";
export type { AdminAnnouncement } from "../gen/publira/admin/v1/announcement_pb.js";
export type { AdminAuditLog } from "../gen/publira/admin/v1/audit_pb.js";
export type {
  AdminComment,
  CommentReport,
} from "../gen/publira/admin/v1/comment_pb.js";
export type { ContactMessage } from "../gen/publira/admin/v1/contact_pb.js";
export type { TenantEmailSettings } from "../gen/publira/admin/v1/email_pb.js";
export type { EpisodeReadThrough } from "../gen/publira/admin/v1/engagement_pb.js";
export type { TenantFcmSettings } from "../gen/publira/admin/v1/fcm_pb.js";
export type {
  TenantAdminInvitation,
  TenantMember,
} from "../gen/publira/admin/v1/member_pb.js";
export type { AdminNotification } from "../gen/publira/admin/v1/notification_pb.js";
export type { TenantPaymentSettings } from "../gen/publira/admin/v1/payment_pb.js";
export type {
  RoyaltyConfig,
  RoyaltyStatement,
  RoyaltyStatementLine,
  RoyaltyStatementTotals,
} from "../gen/publira/admin/v1/royalty_pb.js";
export type {
  TenantAndroidAppAssociation,
  TenantCommunityLimitOverrides,
  TenantIosAppAssociation,
  TenantLegalPage,
  TenantMobileAppAssociation,
  TenantPurchaseSettings,
  TenantRetentionOverrides,
} from "../gen/publira/admin/v1/tenant_pb.js";
export type {
  AdminReader,
  AdminTenantUser,
} from "../gen/publira/admin/v1/user_pb.js";

// platform.v1 limit messages, which the tenant settings RPCs embed as the
// platform values a tenant's own limits are read and bounded against.
export type {
  CommunityLimitDefaults,
  HourDayLimit,
  MinuteDayLimit,
} from "../gen/publira/platform/v1/policy_pb.js";
