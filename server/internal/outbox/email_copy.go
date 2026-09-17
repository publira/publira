package outbox

import (
	"fmt"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/locale"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

// emailCopy composes the two parts of a mail that are the sender's own: the
// subject line, and the plain-text alternative. Both come from the shared
// catalogs, which is what lets a subject change without a build of the
// renderer that produces the HTML part.
func emailCopy(request emailrenderer.Request) (internalsmtp.RenderedEmail, error) {
	compose, ok := emailTemplates[request.Template]
	if !ok {
		return internalsmtp.RenderedEmail{}, fmt.Errorf("unknown email template %q", request.Template)
	}

	mail := &emailComposer{data: request.Data, locale: request.Locale, timeZone: request.TimeZone}
	compose(mail)
	mail.line("email.layout.footer", map[string]string{"brand": mail.brand})
	if mail.err != nil {
		return internalsmtp.RenderedEmail{}, fmt.Errorf("compose %s email: %w", request.Template, mail.err)
	}

	return internalsmtp.RenderedEmail{Subject: mail.subject, Text: strings.Join(mail.lines, "\n\n")}, nil
}

// emailComposer collects one mail's subject and lines. A lookup that fails
// keeps writing so the caller sees the first failure rather than a panic
// halfway down a template.
type emailComposer struct {
	data     map[string]any
	locale   string
	timeZone string
	brand    string
	subject  string
	lines    []string
	err      error
}

func (c *emailComposer) fail(err error) {
	if c.err == nil {
		c.err = err
	}
}

func (c *emailComposer) message(key string, values map[string]string) string {
	rendered, err := locale.Message(c.locale, key, values)
	if err != nil {
		c.fail(err)
		return ""
	}
	return rendered
}

// value is what the handler put under name. The handlers build every payload,
// so a value that is missing or not a string is a fault in this package.
func (c *emailComposer) value(name string) string {
	value, ok := c.data[name].(string)
	if !ok {
		c.fail(fmt.Errorf("%s is missing or is not a string", name))
		return ""
	}
	return value
}

// instant is the RFC3339 value under name, written as the wall clock of the
// display time zone.
func (c *emailComposer) instant(name string) string {
	at, err := time.Parse(time.RFC3339Nano, c.value(name))
	if err != nil {
		c.fail(fmt.Errorf("%s is not an RFC3339 timestamp: %w", name, err))
		return ""
	}
	written, err := locale.FormatDateTime(at, c.locale, c.timeZone)
	if err != nil {
		c.fail(err)
		return ""
	}
	return written
}

// from is who the mail is from, as the recipient knows them. It opens the mail
// and closes it again in the footer, the way EmailLayout shows it.
func (c *emailComposer) from(brand string) {
	c.brand = brand
	c.lines = append(c.lines, brand)
}

func (c *emailComposer) setSubject(key string, values map[string]string) {
	c.subject = c.message(key, values)
}

func (c *emailComposer) line(key string, values map[string]string) {
	c.lines = append(c.lines, c.message(key, values))
}

// text is a line nobody here worded: a reader's own message, quoted to the
// staff it was addressed to. It reaches no catalog, because the mail shows what
// was written rather than saying anything about it.
func (c *emailComposer) text(value string) {
	c.lines = append(c.lines, value)
}

// linkLine is a line the recipient is meant to open: the sentence, then the URL
// it points at. The HTML shows the same pair as a button.
func (c *emailComposer) linkLine(key string, values map[string]string, url string) {
	c.lines = append(c.lines, c.message(key, values)+" "+url)
}

// emailTemplates is the order each mail's lines are read in, one entry per
// template the worker sends. The HTML half of the same mail is the component of
// the same name under packages/email-templates.
var emailTemplates = map[string]func(*emailComposer){
	"admin_console_email_change_confirmation":    adminConsoleEmailChangeConfirmationCopy,
	"admin_console_email_changed_notice":         adminConsoleEmailChangedNoticeCopy,
	"admin_console_password_reset":               adminConsolePasswordResetCopy,
	"platform_console_email_change_confirmation": platformConsoleEmailChangeConfirmationCopy,
	"platform_console_email_changed_notice":      platformConsoleEmailChangedNoticeCopy,
	"platform_console_password_reset":            platformConsolePasswordResetCopy,
	"reader_email_change_confirmation":           readerEmailChangeConfirmationCopy,
	"reader_email_changed_notice":                readerEmailChangedNoticeCopy,
	"reader_email_verification":                  readerEmailVerificationCopy,
	"reader_password_changed_notice":             readerPasswordChangedNoticeCopy,
	"reader_password_reset":                      readerPasswordResetCopy,
	"reader_signup_attempt_notice":               readerSignupAttemptNoticeCopy,
	"staff_contact_message_notice":               staffContactMessageNoticeCopy,
	"tenant_admin_invitation":                    tenantAdminInvitationCopy,
}

// staffContactMessageNoticeCopy words the mail that tells a tenant's staff a
// reader wrote in. The sender and the subject are lines rather than fields: a
// guest leaves the first empty and a reader who titled nothing leaves the
// second, and a labelled blank would read as a value that went missing.
func staffContactMessageNoticeCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	c.setSubject("email.staff_contact_message_notice.subject", map[string]string{"tenant_name": brand})
	c.from(brand)
	c.line("email.staff_contact_message_notice.heading", nil)
	c.line("email.staff_contact_message_notice.intro", map[string]string{"tenant_name": brand})
	c.line("email.staff_contact_message_notice.reply_to", map[string]string{"reply_to_email": c.value("reply_to_email")})
	if sender := c.value("sender_name"); sender != "" {
		c.line("email.staff_contact_message_notice.sender", map[string]string{"sender_name": sender})
	}
	if subject := c.value("subject"); subject != "" {
		c.line("email.staff_contact_message_notice.subject_line", map[string]string{"subject": subject})
	}
	c.line("email.staff_contact_message_notice.received", map[string]string{"received_at": c.instant("received_at")})
	c.line("email.staff_contact_message_notice.body_heading", nil)
	c.text(c.value("body"))
	c.line("email.staff_contact_message_notice.footnote", nil)
}

func tenantAdminInvitationCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	inviteURL := c.value("invite_url")
	c.setSubject("email.tenant_admin_invitation.subject", map[string]string{"tenant_name": brand})
	c.from(brand)
	c.line("email.tenant_admin_invitation.heading", nil)
	c.line("email.tenant_admin_invitation.intro", map[string]string{"tenant_name": brand})
	c.line("email.tenant_admin_invitation.body", map[string]string{"tenant_name": brand})
	c.linkLine("email.tenant_admin_invitation.action", nil, inviteURL)
	c.line("email.tenant_admin_invitation.expires", map[string]string{"expires_at": c.instant("expires_at")})
	c.line("email.tenant_admin_invitation.ignore", nil)
	c.linkLine("email.tenant_admin_invitation.fallback_link", nil, inviteURL)
}

func readerEmailVerificationCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	verifyURL := c.value("verify_url")
	c.setSubject("email.reader_email_verification.subject", map[string]string{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_email_verification.heading", nil)
	c.line("email.reader_email_verification.intro", map[string]string{"tenant_name": brand})
	c.line("email.reader_email_verification.body", nil)
	c.linkLine("email.reader_email_verification.action", nil, verifyURL)
	c.line("email.reader_email_verification.expires", map[string]string{"expires_at": c.instant("expires_at")})
	c.line("email.reader_email_verification.ignore", nil)
	c.linkLine("email.reader_email_verification.fallback_link", nil, verifyURL)
}

func readerEmailChangeConfirmationCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	confirmURL := c.value("confirm_url")
	c.setSubject("email.reader_email_change_confirmation.subject", map[string]string{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_email_change_confirmation.heading", nil)
	c.line("email.reader_email_change_confirmation.intro", nil)
	if c.value("recipient_kind") == "current_email" {
		c.line("email.reader_email_change_confirmation.body_current_email", nil)
	} else {
		c.line("email.reader_email_change_confirmation.body_new_email", nil)
	}
	c.linkLine("email.reader_email_change_confirmation.action", nil, confirmURL)
	c.line("email.reader_email_change_confirmation.expires", map[string]string{"expires_at": c.instant("expires_at")})
	c.line("email.reader_email_change_confirmation.ignore", nil)
	c.line("email.reader_email_change_confirmation.current_email", map[string]string{"current_email": c.value("current_email")})
	c.line("email.reader_email_change_confirmation.new_email", map[string]string{"new_email": c.value("new_email")})
	c.linkLine("email.reader_email_change_confirmation.fallback_link", nil, confirmURL)
}

func readerEmailChangedNoticeCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	c.setSubject("email.reader_email_changed_notice.subject", map[string]string{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_email_changed_notice.heading", nil)
	c.line("email.reader_email_changed_notice.body", nil)
	c.line("email.reader_email_changed_notice.previous_email", map[string]string{"previous_email": c.value("previous_email")})
	c.line("email.reader_email_changed_notice.new_email", map[string]string{"new_email": c.value("new_email")})
	c.line("email.reader_email_changed_notice.warning", nil)
}

func readerPasswordResetCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	resetURL := c.value("reset_url")
	c.setSubject("email.reader_password_reset.subject", map[string]string{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_password_reset.heading", nil)
	c.line("email.reader_password_reset.intro", nil)
	c.line("email.reader_password_reset.body", nil)
	c.linkLine("email.reader_password_reset.action", nil, resetURL)
	c.line("email.reader_password_reset.expires", map[string]string{"expires_at": c.instant("expires_at")})
	c.line("email.reader_password_reset.ignore", nil)
	c.linkLine("email.reader_password_reset.fallback_link", nil, resetURL)
}

func readerPasswordChangedNoticeCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	resetURL := c.value("reset_url")
	c.setSubject("email.reader_password_changed_notice.subject", map[string]string{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_password_changed_notice.heading", nil)
	c.line("email.reader_password_changed_notice.body", nil)
	c.line("email.reader_password_changed_notice.email", map[string]string{"email": c.value("email")})
	c.line("email.reader_password_changed_notice.sessions", nil)
	c.line("email.reader_password_changed_notice.warning", nil)
	c.linkLine("email.reader_password_changed_notice.action", nil, resetURL)
	c.linkLine("email.reader_password_changed_notice.fallback_link", nil, resetURL)
}

func readerSignupAttemptNoticeCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	actionURL := c.value("action_url")
	confirmed := c.value("account_state") == "confirmed"
	c.setSubject("email.reader_signup_attempt_notice.subject", map[string]string{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_signup_attempt_notice.heading", nil)
	c.line("email.reader_signup_attempt_notice.intro", map[string]string{"tenant_name": brand})
	if confirmed {
		c.line("email.reader_signup_attempt_notice.body_confirmed", nil)
	} else {
		c.line("email.reader_signup_attempt_notice.body_unconfirmed", nil)
	}
	c.line("email.reader_signup_attempt_notice.email", map[string]string{"email": c.value("email")})
	if confirmed {
		c.linkLine("email.reader_signup_attempt_notice.action_confirmed", nil, actionURL)
		c.line("email.reader_signup_attempt_notice.forgot_confirmed", nil)
	} else {
		c.linkLine("email.reader_signup_attempt_notice.action_unconfirmed", nil, actionURL)
		c.line("email.reader_signup_attempt_notice.forgot_unconfirmed", nil)
	}
	c.line("email.reader_signup_attempt_notice.ignore", nil)
	c.linkLine("email.reader_signup_attempt_notice.fallback_link", nil, actionURL)
}

func adminConsolePasswordResetCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	resetURL := c.value("reset_url")
	c.setSubject("email.admin_console_password_reset.subject", map[string]string{"tenant_name": brand})
	c.from(brand)
	c.line("email.admin_console_password_reset.heading", nil)
	c.line("email.admin_console_password_reset.intro", nil)
	c.line("email.admin_console_password_reset.body", nil)
	c.linkLine("email.admin_console_password_reset.action", nil, resetURL)
	c.line("email.admin_console_password_reset.expires", map[string]string{"expires_at": c.instant("expires_at")})
	c.line("email.admin_console_password_reset.ignore", nil)
	c.linkLine("email.admin_console_password_reset.fallback_link", nil, resetURL)
}

func adminConsoleEmailChangeConfirmationCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	confirmURL := c.value("confirm_url")
	c.setSubject("email.admin_console_email_change_confirmation.subject", map[string]string{"tenant_name": brand})
	c.from(brand)
	c.line("email.admin_console_email_change_confirmation.heading", nil)
	c.line("email.admin_console_email_change_confirmation.intro", nil)
	if c.value("recipient_kind") == "current_email" {
		c.line("email.admin_console_email_change_confirmation.body_current_email", nil)
	} else {
		c.line("email.admin_console_email_change_confirmation.body_new_email", nil)
	}
	c.linkLine("email.admin_console_email_change_confirmation.action", nil, confirmURL)
	c.line("email.admin_console_email_change_confirmation.expires", map[string]string{"expires_at": c.instant("expires_at")})
	c.line("email.admin_console_email_change_confirmation.ignore", nil)
	c.line("email.admin_console_email_change_confirmation.current_email", map[string]string{"current_email": c.value("current_email")})
	c.line("email.admin_console_email_change_confirmation.new_email", map[string]string{"new_email": c.value("new_email")})
	c.linkLine("email.admin_console_email_change_confirmation.fallback_link", nil, confirmURL)
}

func adminConsoleEmailChangedNoticeCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	c.setSubject("email.admin_console_email_changed_notice.subject", map[string]string{"tenant_name": brand})
	c.from(brand)
	c.line("email.admin_console_email_changed_notice.heading", nil)
	c.line("email.admin_console_email_changed_notice.body", nil)
	c.line("email.admin_console_email_changed_notice.previous_email", map[string]string{"previous_email": c.value("previous_email")})
	c.line("email.admin_console_email_changed_notice.new_email", map[string]string{"new_email": c.value("new_email")})
	c.line("email.admin_console_email_changed_notice.warning", nil)
}

func platformConsolePasswordResetCopy(c *emailComposer) {
	resetURL := c.value("reset_url")
	c.setSubject("email.platform_console_password_reset.subject", nil)
	c.from(c.message("email.layout.brand", nil))
	c.line("email.platform_console_password_reset.heading", nil)
	c.line("email.platform_console_password_reset.intro", nil)
	c.line("email.platform_console_password_reset.body", nil)
	c.linkLine("email.platform_console_password_reset.action", nil, resetURL)
	c.line("email.platform_console_password_reset.expires", map[string]string{"expires_at": c.instant("expires_at")})
	c.line("email.platform_console_password_reset.ignore", nil)
	c.linkLine("email.platform_console_password_reset.fallback_link", nil, resetURL)
}

func platformConsoleEmailChangeConfirmationCopy(c *emailComposer) {
	confirmURL := c.value("confirm_url")
	c.setSubject("email.platform_console_email_change_confirmation.subject", nil)
	c.from(c.message("email.layout.brand", nil))
	c.line("email.platform_console_email_change_confirmation.heading", nil)
	c.line("email.platform_console_email_change_confirmation.intro", nil)
	if c.value("recipient_kind") == "current_email" {
		c.line("email.platform_console_email_change_confirmation.body_current_email", nil)
	} else {
		c.line("email.platform_console_email_change_confirmation.body_new_email", nil)
	}
	c.linkLine("email.platform_console_email_change_confirmation.action", nil, confirmURL)
	c.line("email.platform_console_email_change_confirmation.expires", map[string]string{"expires_at": c.instant("expires_at")})
	c.line("email.platform_console_email_change_confirmation.ignore", nil)
	c.line("email.platform_console_email_change_confirmation.current_email", map[string]string{"current_email": c.value("current_email")})
	c.line("email.platform_console_email_change_confirmation.new_email", map[string]string{"new_email": c.value("new_email")})
	c.linkLine("email.platform_console_email_change_confirmation.fallback_link", nil, confirmURL)
}

func platformConsoleEmailChangedNoticeCopy(c *emailComposer) {
	c.setSubject("email.platform_console_email_changed_notice.subject", nil)
	c.from(c.message("email.layout.brand", nil))
	c.line("email.platform_console_email_changed_notice.heading", nil)
	c.line("email.platform_console_email_changed_notice.body", nil)
	c.line("email.platform_console_email_changed_notice.previous_email", map[string]string{"previous_email": c.value("previous_email")})
	c.line("email.platform_console_email_changed_notice.new_email", map[string]string{"new_email": c.value("new_email")})
	c.line("email.platform_console_email_changed_notice.warning", nil)
}
