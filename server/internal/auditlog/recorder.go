// Package auditlog provides structured audit logging for admin operations.
package auditlog

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	OutcomeSuccess = "success"
	OutcomeFailure = "failure"
)

// Querier is the minimal DB interface required by Recorder.
type Querier interface {
	InsertPlatformAuditLog(ctx context.Context, arg dbmodels.InsertPlatformAuditLogParams) error
	InsertAuditLog(ctx context.Context, arg dbmodels.InsertAuditLogParams) error
}

// PlatformEntry holds the data for a platform audit log event.
type PlatformEntry struct {
	ActorPlatformUserID uuid.UUID
	ActorRole           string
	Action              string
	TargetType          string // e.g. "series", "episode", "tenant", "operator", "user"
	TargetID            string // ID of the affected resource
	Outcome             string // "success" or "failure"
	Reason              string // populated on failure
	ClientIP            string
}

// TenantEntry holds the data for a tenant audit log event.
type TenantEntry struct {
	TenantID    uuid.UUID
	ActorUserID uuid.UUID
	ActorRole   string
	Action      string
	TargetType  string // e.g. "series", "episode", "creator", "label"
	TargetID    string // ID of the affected resource
	Outcome     string // "success" or "failure"
	Reason      string // populated on failure
	ClientIP    string
}

// Recorder persists audit log entries to DB and emits structured log lines.
type Recorder struct {
	queries Querier
	logger  *slog.Logger
}

// New creates a Recorder using the given DB querier and logger.
func New(queries Querier, logger *slog.Logger) *Recorder {
	if logger == nil {
		logger = slog.Default()
	}
	return &Recorder{queries: queries, logger: logger}
}

// RecordPlatform writes a platform audit entry. A DB error is logged but does not propagate.
func (r *Recorder) RecordPlatform(ctx context.Context, e PlatformEntry) {
	r.logger.InfoContext(ctx, "audit",
		"actor_platform_user_id", e.ActorPlatformUserID,
		"actor_role", e.ActorRole,
		"action", e.Action,
		"target_type", e.TargetType,
		"target_id", e.TargetID,
		"outcome", e.Outcome,
		"reason", e.Reason,
		"client_ip", e.ClientIP,
	)

	id, err := uuid.NewV7()
	if err != nil {
		r.logger.ErrorContext(ctx, "auditlog: failed to generate id", "error", err)
		return
	}

	err = r.queries.InsertPlatformAuditLog(ctx, dbmodels.InsertPlatformAuditLogParams{
		ID:                  id,
		ActorPlatformUserID: e.ActorPlatformUserID,
		ActorRole:           e.ActorRole,
		Action:              e.Action,
		TargetType:          sql.NullString{String: e.TargetType, Valid: e.TargetType != ""},
		TargetID:            sql.NullString{String: e.TargetID, Valid: e.TargetID != ""},
		Outcome:             e.Outcome,
		Reason:              sql.NullString{String: e.Reason, Valid: e.Reason != ""},
		ClientIp:            sql.NullString{String: e.ClientIP, Valid: e.ClientIP != ""},
	})
	if err != nil {
		r.logger.ErrorContext(ctx, "auditlog: failed to persist", "error", err, "action", e.Action)
	}
}

// RecordTenant writes a tenant audit entry. A DB error is logged but does not propagate.
func (r *Recorder) RecordTenant(ctx context.Context, e TenantEntry) {
	r.logger.InfoContext(ctx, "audit",
		"tenant_id", e.TenantID,
		"actor_user_id", e.ActorUserID,
		"actor_role", e.ActorRole,
		"action", e.Action,
		"target_type", e.TargetType,
		"target_id", e.TargetID,
		"outcome", e.Outcome,
		"reason", e.Reason,
		"client_ip", e.ClientIP,
	)

	id, err := uuid.NewV7()
	if err != nil {
		r.logger.ErrorContext(ctx, "auditlog: failed to generate id", "error", err)
		return
	}

	err = r.queries.InsertAuditLog(ctx, dbmodels.InsertAuditLogParams{
		ID:          id,
		TenantID:    e.TenantID,
		ActorUserID: e.ActorUserID,
		ActorRole:   e.ActorRole,
		Action:      e.Action,
		TargetType:  sql.NullString{String: e.TargetType, Valid: e.TargetType != ""},
		TargetID:    sql.NullString{String: e.TargetID, Valid: e.TargetID != ""},
		Outcome:     e.Outcome,
		Reason:      sql.NullString{String: e.Reason, Valid: e.Reason != ""},
		ClientIp:    sql.NullString{String: e.ClientIP, Valid: e.ClientIP != ""},
	})
	if err != nil {
		r.logger.ErrorContext(ctx, "auditlog: failed to persist", "error", err, "action", e.Action)
	}
}

// ClientIPFromHeader returns the first IP address from the X-Forwarded-For header.
func ClientIPFromHeader(headers http.Header) string {
	v := headers.Get("X-Forwarded-For")
	if v == "" {
		return ""
	}
	parts := strings.SplitN(v, ",", 2)
	return strings.TrimSpace(parts[0])
}
