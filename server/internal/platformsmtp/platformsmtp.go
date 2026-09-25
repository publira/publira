// Package platformsmtp saves the SMTP settings the worker sends the platform's
// mail with, and sends a test message through them. The platform API's
// PlatformEmailSettingsService and publiractl smtp are adapters over it.
//
// A refusal of what the caller asked for is a [*fielderr.Invalid] naming the
// field at fault, [ErrConflict], [ErrNotSaved], or a [*TestFailure]; any other
// error is the database's.
package platformsmtp

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/secretupdate"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

// The fields refused here beside those of [emailsettings.Validate].
const (
	FieldPasswordUpdateMode = "password_update_mode"
	FieldExpectedRevision   = "expected_revision"
	FieldRecipientType      = "recipient_type"
	FieldRecipientEmail     = "recipient_email"
)

var (
	// ErrConflict refuses a save based on a revision the stored row has moved
	// past.
	ErrConflict = errors.New("platform email settings have changed since they were read")
	// ErrNotSaved is what a test of the saved settings finds when there are
	// none.
	ErrNotSaved = errors.New("platform SMTP settings are not saved")

	errNegativeRevision = errors.New("expected_revision must not be negative")
)

// Querier reads the saved settings.
type Querier interface {
	GetPlatformSMTPConfig(ctx context.Context) (dbmodels.PlatformSmtpConfig, error)
}

// Get reads the saved settings, reporting false when there are none.
func Get(ctx context.Context, q Querier) (dbmodels.PlatformSmtpConfig, bool, error) {
	config, err := q.GetPlatformSMTPConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.PlatformSmtpConfig{}, false, nil
	}
	if err != nil {
		return dbmodels.PlatformSmtpConfig{}, false, fmt.Errorf("get platform smtp config: %w", err)
	}
	return config, true, nil
}

// HasPassword reports whether config stores a password.
func HasPassword(config dbmodels.PlatformSmtpConfig) bool {
	return strings.TrimSpace(config.PasswordEncrypted) != ""
}

// settingsOf is config with password in place of its ciphertext.
func settingsOf(config dbmodels.PlatformSmtpConfig, password string) emailsettings.SMTPSettings {
	settings := emailsettings.SMTPSettings{
		Host:        config.Host,
		Port:        config.Port,
		Username:    config.Username,
		Password:    password,
		Encryption:  config.Encryption,
		FromAddress: config.FromAddress,
	}
	if config.ReplyTo.Valid {
		settings.ReplyTo = config.ReplyTo.String
	}
	return settings
}

// SaveParams replaces the saved settings. Settings.Password is ignored: the
// password is PasswordMode applied to Password.
type SaveParams struct {
	Settings     emailsettings.SMTPSettings
	PasswordMode secretupdate.Mode
	Password     string
	// ExpectedRevision is the revision Settings were read at, 0 when none were
	// saved. Nil saves over whatever is stored, for a caller that read nothing.
	ExpectedRevision *int64
}

// Validate refuses p without reading anything.
func (p SaveParams) Validate() error {
	if err := emailsettings.Validate(p.Settings, false); err != nil {
		return err
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision < 0 {
		return &fielderr.Invalid{Field: FieldExpectedRevision, Err: errNegativeRevision}
	}
	return nil
}

// Save writes p in one transaction on db, with its entry filed under actor.
// The row is locked first, so the password a save keeps is the one its
// revision was compared against rather than one another session has since
// replaced.
func Save(
	ctx context.Context,
	db *sql.DB,
	logger *slog.Logger,
	encryptor emailsettings.SecretManager,
	actor auditlog.PlatformActor,
	p SaveParams,
) (dbmodels.PlatformSmtpConfig, error) {
	if err := p.Validate(); err != nil {
		return dbmodels.PlatformSmtpConfig{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformSmtpConfig{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	saved, err := write(ctx, q, encryptor, p)
	if err != nil {
		return dbmodels.PlatformSmtpConfig{}, err
	}
	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		Action:     "platform_email_settings_updated",
		TargetType: "smtp_config",
		TargetID:   "platform",
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return dbmodels.PlatformSmtpConfig{}, fmt.Errorf("audit platform_email_settings_updated: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformSmtpConfig{}, fmt.Errorf("commit: %w", err)
	}
	return saved, nil
}

func write(ctx context.Context, q *dbmodels.Queries, encryptor emailsettings.SecretManager, p SaveParams) (dbmodels.PlatformSmtpConfig, error) {
	current, err := q.LockPlatformSMTPConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if p.ExpectedRevision != nil && *p.ExpectedRevision != 0 {
			return dbmodels.PlatformSmtpConfig{}, ErrConflict
		}
		params, err := configParams(p, "", encryptor)
		if err != nil {
			return dbmodels.PlatformSmtpConfig{}, err
		}
		inserted, err := q.InsertPlatformSMTPConfig(ctx, dbmodels.InsertPlatformSMTPConfigParams(params))
		// Two first saves both find nothing to lock; the primary key settles
		// which one wins.
		if dberr.IsUniqueViolation(err) {
			return dbmodels.PlatformSmtpConfig{}, ErrConflict
		}
		if err != nil {
			return dbmodels.PlatformSmtpConfig{}, fmt.Errorf("insert platform smtp config: %w", err)
		}
		return inserted, nil
	}
	if err != nil {
		return dbmodels.PlatformSmtpConfig{}, fmt.Errorf("lock platform smtp config: %w", err)
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision != current.Revision {
		return dbmodels.PlatformSmtpConfig{}, ErrConflict
	}
	params, err := configParams(p, current.PasswordEncrypted, encryptor)
	if err != nil {
		return dbmodels.PlatformSmtpConfig{}, err
	}
	updated, err := q.UpdatePlatformSMTPConfig(ctx, params)
	if err != nil {
		return dbmodels.PlatformSmtpConfig{}, fmt.Errorf("update platform smtp config: %w", err)
	}
	return updated, nil
}

// configParams resolves the password the row ends up holding from the stored
// ciphertext, which is empty when nothing is saved yet.
func configParams(p SaveParams, existingPassword string, encryptor emailsettings.SecretManager) (dbmodels.UpdatePlatformSMTPConfigParams, error) {
	encryptedPassword, hasPassword, err := emailsettings.EncryptUpdatedPassword(existingPassword, p.PasswordMode, p.Password, encryptor)
	if err != nil {
		return dbmodels.UpdatePlatformSMTPConfigParams{}, passwordError(err)
	}
	if !hasPassword {
		return dbmodels.UpdatePlatformSMTPConfigParams{}, passwordError(emailsettings.ErrPasswordRequired)
	}
	settings := emailsettings.Normalize(p.Settings)
	return dbmodels.UpdatePlatformSMTPConfigParams{
		Host:              settings.Host,
		Port:              settings.Port,
		Username:          settings.Username,
		PasswordEncrypted: encryptedPassword,
		Encryption:        settings.Encryption,
		FromAddress:       settings.FromAddress,
		ReplyTo:           sql.NullString{String: settings.ReplyTo, Valid: settings.ReplyTo != ""},
	}, nil
}

// passwordError names the field behind a password that could not be resolved.
func passwordError(err error) error {
	if errors.Is(err, secretupdate.ErrInvalidMode) {
		return &fielderr.Invalid{Field: FieldPasswordUpdateMode, Err: err}
	}
	return &fielderr.Invalid{Field: emailsettings.FieldPassword, Err: err}
}

// TestFailure is a test message the SMTP server did not take. Reason
// classifies it as [internalsmtp.TestFailureReason] does.
type TestFailure struct {
	Reason string
	Err    error
}

func (e *TestFailure) Error() string {
	return fmt.Sprintf("the test message was not sent (%s): %v", e.Reason, e.Err)
}

func (e *TestFailure) Unwrap() error { return e.Err }

// TestParams sends the test message through settings that may not be saved.
// The password is PasswordMode applied to Password, over the saved one.
type TestParams struct {
	Settings       emailsettings.SMTPSettings
	PasswordMode   secretupdate.Mode
	Password       string
	RecipientType  int32
	RecipientEmail string
	// SelfEmail is where [emailsettings.TestRecipientTypeSelf] sends.
	SelfEmail string
}

// Tester sends the test message and files an entry for every attempt.
type Tester struct {
	Encryptor emailsettings.SecretManager
	SMTP      internalsmtp.Tester
	Recorder  auditlog.Recorder
}

// Send sends the test message through p's settings and answers where it went.
func (t Tester) Send(ctx context.Context, q Querier, actor auditlog.PlatformActor, p TestParams) (string, error) {
	saved, _, err := Get(ctx, q)
	if err != nil {
		return "", err
	}
	password, err := emailsettings.ResolvePasswordForTest(saved.PasswordEncrypted, p.PasswordMode, p.Password, t.Encryptor)
	if err != nil {
		return "", passwordError(err)
	}
	settings := p.Settings
	settings.Password = password
	if err := emailsettings.Validate(settings, true); err != nil {
		return "", err
	}
	recipient, err := emailsettings.ResolveRecipient(p.RecipientType, p.RecipientEmail, p.SelfEmail)
	if err != nil {
		field := FieldRecipientType
		if p.RecipientType == emailsettings.TestRecipientTypeCustom {
			field = FieldRecipientEmail
		}
		return "", &fielderr.Invalid{Field: field, Err: err}
	}
	return recipient, t.send(ctx, actor, settings, recipient)
}

// SendSaved sends the test message through the saved settings, as the worker
// would send its next mail, to recipient.
func (t Tester) SendSaved(ctx context.Context, q Querier, actor auditlog.PlatformActor, recipient string) error {
	saved, found, err := Get(ctx, q)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotSaved
	}
	recipient, err = emailsettings.ResolveRecipient(emailsettings.TestRecipientTypeCustom, recipient, "")
	if err != nil {
		return &fielderr.Invalid{Field: FieldRecipientEmail, Err: err}
	}
	password, err := emailsettings.DecryptPassword(saved.PasswordEncrypted, t.Encryptor)
	if err != nil {
		return passwordError(err)
	}
	settings := settingsOf(saved, password)
	if err := emailsettings.Validate(settings, true); err != nil {
		return err
	}
	return t.send(ctx, actor, settings, recipient)
}

func (t Tester) send(ctx context.Context, actor auditlog.PlatformActor, settings emailsettings.SMTPSettings, recipient string) error {
	entry := auditlog.PlatformEntry{
		Action:     "platform_smtp_test_email_sent",
		TargetType: "smtp_config",
		TargetID:   "platform",
		Outcome:    auditlog.OutcomeSuccess,
	}
	if err := t.SMTP.SendTestEmail(ctx, settings, recipient); err != nil {
		failure := &TestFailure{Reason: internalsmtp.TestFailureReason(err), Err: err}
		entry.Outcome, entry.Reason = auditlog.OutcomeFailure, failure.Reason
		t.Recorder.RecordPlatform(ctx, actor.Entry(entry))
		return failure
	}
	t.Recorder.RecordPlatform(ctx, actor.Entry(entry))
	return nil
}
