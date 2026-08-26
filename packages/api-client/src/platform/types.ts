// Platform.v1 entity messages, so mappers can Pick them the same way as
// types.v1. Request/response wrappers stay on the per-service modules.
export type { PlatformAuditLog } from "../gen/publira/platform/v1/audit_pb.js";
export type { DashboardRecentEvent } from "../gen/publira/platform/v1/dashboard_pb.js";
export type { PlatformEmailSettings } from "../gen/publira/platform/v1/email_pb.js";
export type { PlatformNotification } from "../gen/publira/platform/v1/notification_pb.js";
export type { PlatformOperator } from "../gen/publira/platform/v1/operator_pb.js";
export type { PlatformSettings } from "../gen/publira/platform/v1/settings_pb.js";
export type {
  Tenant,
  TenantAdminInvitation,
  TenantMember,
} from "../gen/publira/platform/v1/tenant_pb.js";
export type { EndUser } from "../gen/publira/platform/v1/user_pb.js";
