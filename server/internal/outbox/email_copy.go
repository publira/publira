package outbox

import (
	"fmt"
	"strconv"
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
	mail.line("email.layout.footer", map[string]any{"brand": mail.brand})
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

func (c *emailComposer) message(key string, values map[string]any) string {
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

// flag is the boolean the handler put under name.
func (c *emailComposer) flag(name string) bool {
	value, ok := c.data[name].(bool)
	if !ok {
		c.fail(fmt.Errorf("%s is missing or is not a bool", name))
	}
	return value
}

// integer is the int64 the handler put under name.
func (c *emailComposer) integer(name string) int64 {
	value, ok := c.data[name].(int64)
	if !ok {
		c.fail(fmt.Errorf("%s is missing or is not an int64", name))
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

// price is the amount under amountName, an integer in the minor unit of the
// currency under currencyName, written the way the locale writes that currency.
func (c *emailComposer) price(amountName, currencyName string) string {
	amount, ok := c.data[amountName].(int64)
	if !ok {
		c.fail(fmt.Errorf("%s is missing or is not an int64", amountName))
		return ""
	}
	written, err := locale.FormatPrice(amount, c.value(currencyName), c.locale)
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

// setSubject words the subject line. A title a tenant wrote may span lines,
// and a header holds one, so each break and the spaces around it become one
// space; the lines of the mail keep the title as it was written.
func (c *emailComposer) setSubject(key string, values map[string]any) {
	lines := strings.FieldsFunc(c.message(key, values), func(r rune) bool { return r == '\r' || r == '\n' })
	for i, line := range lines {
		lines[i] = strings.TrimSpace(line)
	}
	c.subject = strings.Join(lines, " ")
}

func (c *emailComposer) line(key string, values map[string]any) {
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
func (c *emailComposer) linkLine(key string, values map[string]any, url string) {
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
	"platform_console_operator_added":            platformConsoleOperatorAddedCopy,
	"platform_console_operator_role_granted":     platformConsoleOperatorRoleGrantedCopy,
	"platform_console_password_reset":            platformConsolePasswordResetCopy,
	"purchase_receipt":                           purchaseReceiptCopy,
	"purchase_refund_notice":                     purchaseRefundNoticeCopy,
	"reader_announcement_posted":                 readerAnnouncementPostedCopy,
	"reader_comment_approved":                    readerCommentApprovedCopy,
	"reader_data_export_ready":                   readerDataExportReadyCopy,
	"reader_email_change_confirmation":           readerEmailChangeConfirmationCopy,
	"reader_email_changed_notice":                readerEmailChangedNoticeCopy,
	"reader_email_verification":                  readerEmailVerificationCopy,
	"reader_episode_published":                   readerEpisodePublishedCopy,
	"reader_password_changed_notice":             readerPasswordChangedNoticeCopy,
	"reader_password_reset":                      readerPasswordResetCopy,
	"reader_signup_attempt_notice":               readerSignupAttemptNoticeCopy,
	"staff_contact_message_notice":               staffContactMessageNoticeCopy,
	"staff_contact_reply":                        staffContactReplyCopy,
	"staff_episode_review_returned":              staffEpisodeReviewReturnedCopy,
	"subscription_renewed":                       subscriptionPaymentCopy("subscription_renewed"),
	"subscription_started":                       subscriptionPaymentCopy("subscription_started"),
	"tenant_admin_invitation":                    tenantAdminInvitationCopy,
}

// basisPointsAsPercent writes a rate in basis points as the number of a
// percentage, with no trailing zero: 10 for 1000, 8.5 for 850, 10.21 for 1021.
// Every locale the catalogs carry writes a decimal point as a full stop, and
// the copy puts the % sign after it. formatBasisPointsAsPercent in
// packages/email-templates writes the same.
func basisPointsAsPercent(bps int64) string {
	whole, fraction := bps/100, bps%100
	switch {
	case fraction == 0:
		return strconv.FormatInt(whole, 10)
	case fraction%10 == 0:
		return fmt.Sprintf("%d.%d", whole, fraction/10)
	default:
		return fmt.Sprintf("%d.%02d", whole, fraction)
	}
}

// purchaseReceiptCopy words the receipt a reader is sent for a purchase. The
// price names its currency by code as well as by symbol, because a symbol such
// as "$" stands for more than one currency. A purchase with no reading period
// has no line saying when it ends, and one made without a tax rate no line
// stating its tax; the tenant's legal name and registration number are lines
// of their own where it has entered them. A purchase paid in the provider's test mode,
// which the documented setup asks an operator to make, says it charged nothing,
// so its "price paid" is not read as money taken. A purchase of a volume names
// the volume where a purchase of an episode names the episode, and a purchase
// of the rest of a series how many episodes it bought. A purchase of a pack of
// coins names no series, since it is of none: it says how many of the tenant's
// coins it bought, under the tenant's word for them, and until when they can
// be spent, which a prepaid instrument has to state. A tip to the Authors of an
// episode is worded as a tip throughout, since the reader bought nothing.
func purchaseReceiptCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	libraryURL := c.value("library_url")
	tip := c.flag("is_tip")
	if tip {
		c.setSubject("email.purchase_receipt.tip_subject", map[string]any{"tenant_name": brand})
	} else {
		c.setSubject("email.purchase_receipt.subject", map[string]any{"tenant_name": brand})
	}
	c.from(brand)
	if tip {
		c.line("email.purchase_receipt.tip_heading", nil)
		c.line("email.purchase_receipt.tip_intro", map[string]any{"tenant_name": brand})
	} else {
		c.line("email.purchase_receipt.heading", nil)
		c.line("email.purchase_receipt.intro", map[string]any{"tenant_name": brand})
	}
	if c.flag("is_test") {
		c.line("email.purchase_receipt.test_notice", nil)
	}
	coins, bonusCoins := c.integer("coin_pack_coins"), c.integer("coin_pack_bonus_coins")
	if coins == 0 {
		c.line("email.purchase_receipt.series", map[string]any{"series_title": c.value("series_title")})
	}
	switch count := c.integer("series_bundle_episode_count"); {
	case tip:
		c.line("email.purchase_receipt.tip", map[string]any{"episode_title": c.value("episode_title")})
	case coins > 0:
		c.line("email.purchase_receipt.coin_pack", map[string]any{"coin_name": c.value("coin_name"), "count": int(coins + bonusCoins), "bonus": int(bonusCoins)})
	case c.value("volume_title") != "":
		c.line("email.purchase_receipt.volume", map[string]any{"volume_title": c.value("volume_title")})
	case count > 0:
		c.line("email.purchase_receipt.series_bundle", map[string]any{"count": int(count)})
	default:
		c.line("email.purchase_receipt.episode", map[string]any{"episode_title": c.value("episode_title")})
	}
	if tip {
		c.line("email.purchase_receipt.tip_amount", map[string]any{"amount": c.price("amount", "currency"), "currency": c.value("currency")})
	} else {
		c.line("email.purchase_receipt.amount", map[string]any{"amount": c.price("amount", "currency"), "currency": c.value("currency")})
	}
	if rate := c.integer("tax_rate_bps"); rate > 0 {
		c.line("email.purchase_receipt.tax", map[string]any{"amount": c.price("tax_amount", "currency"), "rate": basisPointsAsPercent(rate)})
	}
	if tip {
		c.line("email.purchase_receipt.tip_given_at", map[string]any{"purchased_at": c.instant("purchased_at")})
	} else {
		c.line("email.purchase_receipt.purchased_at", map[string]any{"purchased_at": c.instant("purchased_at")})
	}
	if c.value("expires_at") != "" {
		c.line("email.purchase_receipt.expires_at", map[string]any{"expires_at": c.instant("expires_at")})
	}
	if c.value("coins_expire_at") != "" {
		c.line("email.purchase_receipt.coins_expire_at", map[string]any{"expires_at": c.instant("coins_expire_at")})
	}
	if name := c.value("invoice_legal_name"); name != "" {
		c.line("email.purchase_receipt.issuer", map[string]any{"legal_name": name})
	}
	if number := c.value("invoice_registration_number"); number != "" {
		c.line("email.purchase_receipt.registration_number", map[string]any{"registration_number": number})
	}
	c.linkLine("email.purchase_receipt.action", nil, libraryURL)
	c.linkLine("email.purchase_receipt.fallback_link", nil, libraryURL)
}

// subscriptionPaymentCopy words the mails that tell a reader an invoice of
// their subscription was paid: the first one, which started it, or a later one,
// which renewed it for a new period. template is the mail's ID, which is also
// the namespace of its copy, the only thing in which the two differ. The mail
// names the plan, the price paid with its currency by code as well as by
// symbol, as the receipt does, and the period that payment covers, whose end is
// when the plan's episodes stay open until and when the plan renews next unless
// the reader cancels it. The reader manages the subscription from Manage
// billing on My Page, which the mail links to. An invoice paid in the
// provider's test mode says no money moved, as a receipt does.
func subscriptionPaymentCopy(template string) func(*emailComposer) {
	key := func(name string) string { return "email." + template + "." + name }
	return func(c *emailComposer) {
		brand := c.value("tenant_name")
		myPageURL := c.value("my_page_url")
		c.setSubject(key("subject"), map[string]any{"tenant_name": brand})
		c.from(brand)
		c.line(key("heading"), nil)
		c.line(key("intro"), map[string]any{"tenant_name": brand})
		if c.flag("is_test") {
			c.line(key("test_notice"), nil)
		}
		periodEnd := c.instant("period_end")
		c.line(key("plan"), map[string]any{"plan_name": c.value("plan_name")})
		c.line(key("amount"), map[string]any{"amount": c.price("amount", "currency"), "currency": c.value("currency")})
		c.line(key("period"), map[string]any{"period_start": c.instant("period_start"), "period_end": periodEnd})
		c.line(key("open_until"), map[string]any{"period_end": periodEnd})
		c.line(key("manage"), nil)
		c.linkLine(key("action"), nil, myPageURL)
		c.linkLine(key("fallback_link"), nil, myPageURL)
	}
}

// purchaseRefundNoticeCopy words the mail that tells a reader a refund was
// made on one of their purchases. It names what was bought as the receipt
// does, what this refund returned, and, once more than one refund has been
// made, what they add up to against the price paid. It then says what the
// refund takes away: a purchase refunded in full no longer opens what it
// bought, and a pack refunded in full gives up the coins it has left, while a
// refund of part of the price takes neither. That promises no access, since a
// rental whose period has passed opens nothing either way. A tip opened nothing,
// so its mail says nothing of it. A purchase made in the provider's test mode
// says no money moved, as its receipt did.
func purchaseRefundNoticeCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	libraryURL := c.value("library_url")
	tip := c.flag("is_tip")
	closed := c.flag("closed")
	c.setSubject("email.purchase_refund_notice.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.purchase_refund_notice.heading", nil)
	c.line("email.purchase_refund_notice.intro", map[string]any{"tenant_name": brand})
	if c.flag("is_test") {
		c.line("email.purchase_refund_notice.test_notice", nil)
	}
	coins, bonusCoins := c.integer("coin_pack_coins"), c.integer("coin_pack_bonus_coins")
	if coins == 0 {
		c.line("email.purchase_refund_notice.series", map[string]any{"series_title": c.value("series_title")})
	}
	switch count := c.integer("series_bundle_episode_count"); {
	case tip:
		c.line("email.purchase_refund_notice.tip", map[string]any{"episode_title": c.value("episode_title")})
	case coins > 0:
		c.line("email.purchase_refund_notice.coin_pack", map[string]any{"coin_name": c.value("coin_name"), "count": int(coins + bonusCoins), "bonus": int(bonusCoins)})
	case c.value("volume_title") != "":
		c.line("email.purchase_refund_notice.volume", map[string]any{"volume_title": c.value("volume_title")})
	case count > 0:
		c.line("email.purchase_refund_notice.series_bundle", map[string]any{"count": int(count)})
	default:
		c.line("email.purchase_refund_notice.episode", map[string]any{"episode_title": c.value("episode_title")})
	}
	c.line("email.purchase_refund_notice.amount", map[string]any{"amount": c.price("amount", "currency"), "currency": c.value("currency")})
	if c.integer("refunded_total") > c.integer("amount") {
		c.line("email.purchase_refund_notice.total", map[string]any{"total": c.price("refunded_total", "currency"), "price": c.price("price", "currency")})
	}
	switch {
	case tip:
	case coins > 0 && closed:
		c.line("email.purchase_refund_notice.coins_closed", map[string]any{"coin_name": c.value("coin_name")})
	case coins > 0:
		c.line("email.purchase_refund_notice.coins_open", map[string]any{"coin_name": c.value("coin_name")})
	case closed:
		c.line("email.purchase_refund_notice.closed", nil)
	default:
		c.line("email.purchase_refund_notice.open", nil)
	}
	c.linkLine("email.purchase_refund_notice.action", nil, libraryURL)
	c.linkLine("email.purchase_refund_notice.fallback_link", nil, libraryURL)
}

// readerEpisodePublishedCopy words the mail that tells a reader an episode
// they asked to hear about is out. Every notification mail ends on where the
// reader chooses which of them they receive.
func readerEpisodePublishedCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	episodeURL := c.value("episode_url")
	c.setSubject("email.reader_episode_published.subject", map[string]any{"series_title": c.value("series_title")})
	c.from(brand)
	c.line("email.reader_episode_published.heading", nil)
	c.line("email.reader_episode_published.intro", map[string]any{"tenant_name": brand})
	c.line("email.reader_episode_published.series", map[string]any{"series_title": c.value("series_title")})
	c.line("email.reader_episode_published.episode", map[string]any{"episode_title": c.value("episode_title")})
	c.linkLine("email.reader_episode_published.action", nil, episodeURL)
	c.linkLine("email.reader_episode_published.fallback_link", nil, episodeURL)
	c.linkLine("email.reader_episode_published.preferences", nil, c.value("settings_url"))
}

// readerAnnouncementPostedCopy words the mail that carries the title of an
// announcement the tenant posted. One sent to every reader says so instead of
// pointing at the settings, which could not have kept it out.
func readerAnnouncementPostedCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	title := c.value("announcement_title")
	announcementsURL := c.value("announcements_url")
	c.setSubject("email.reader_announcement_posted.subject", map[string]any{"announcement_title": title, "tenant_name": brand})
	c.from(brand)
	c.line("email.reader_announcement_posted.heading", nil)
	c.line("email.reader_announcement_posted.intro", map[string]any{"tenant_name": brand})
	c.line("email.reader_announcement_posted.title", map[string]any{"announcement_title": title})
	c.linkLine("email.reader_announcement_posted.action", nil, announcementsURL)
	c.linkLine("email.reader_announcement_posted.fallback_link", nil, announcementsURL)
	if c.flag("sent_to_everyone") {
		c.line("email.reader_announcement_posted.everyone", map[string]any{"tenant_name": brand})
	} else {
		c.linkLine("email.reader_announcement_posted.preferences", nil, c.value("settings_url"))
	}
}

// readerCommentApprovedCopy words the mail that tells a reader the comment they
// posted is now public, naming the episode it is on.
func readerCommentApprovedCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	episodeURL := c.value("episode_url")
	c.setSubject("email.reader_comment_approved.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_comment_approved.heading", nil)
	c.line("email.reader_comment_approved.body", nil)
	c.line("email.reader_comment_approved.series", map[string]any{"series_title": c.value("series_title")})
	c.line("email.reader_comment_approved.episode", map[string]any{"episode_title": c.value("episode_title")})
	c.linkLine("email.reader_comment_approved.action", nil, episodeURL)
	c.linkLine("email.reader_comment_approved.fallback_link", nil, episodeURL)
	c.linkLine("email.reader_comment_approved.preferences", nil, c.value("settings_url"))
}

// readerDataExportReadyCopy words the mail that tells a reader the archive
// they asked for is ready, and until when it can be downloaded. It links no
// notification settings: the reader asked for it, and none of them could have
// kept it out.
func readerDataExportReadyCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	settingsURL := c.value("settings_url")
	c.setSubject("email.reader_data_export_ready.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_data_export_ready.heading", nil)
	c.line("email.reader_data_export_ready.body", map[string]any{"tenant_name": brand})
	c.line("email.reader_data_export_ready.expires_at", map[string]any{"expires_at": c.instant("expires_at")})
	c.linkLine("email.reader_data_export_ready.action", nil, settingsURL)
	c.linkLine("email.reader_data_export_ready.fallback_link", nil, settingsURL)
}

// staffContactMessageNoticeCopy words the mail that tells a tenant's staff a
// reader wrote in. The sender and the subject are lines rather than fields: a
// guest leaves the first empty and a reader who titled nothing leaves the
// second, and a labelled blank would read as a value that went missing.
func staffContactMessageNoticeCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	c.setSubject("email.staff_contact_message_notice.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.staff_contact_message_notice.heading", nil)
	c.line("email.staff_contact_message_notice.intro", map[string]any{"tenant_name": brand})
	c.line("email.staff_contact_message_notice.reply_to", map[string]any{"reply_to_email": c.value("reply_to_email")})
	if sender := c.value("sender_name"); sender != "" {
		c.line("email.staff_contact_message_notice.sender", map[string]any{"sender_name": sender})
	}
	if subject := c.value("subject"); subject != "" {
		c.line("email.staff_contact_message_notice.subject_line", map[string]any{"subject": subject})
	}
	c.line("email.staff_contact_message_notice.received", map[string]any{"received_at": c.instant("received_at")})
	c.line("email.staff_contact_message_notice.body_heading", nil)
	c.text(c.value("body"))
	c.line("email.staff_contact_message_notice.footnote", nil)
}

// staffEpisodeReviewReturnedCopy words the mail that tells a member of staff a
// Tenant admin sent their episode back. The comment is the point of it, so it
// travels with the mail, and the link opens the episode where it is fixed.
func staffEpisodeReviewReturnedCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	episodeURL := c.value("episode_url")
	c.setSubject("email.staff_episode_review_returned.subject", map[string]any{"episode_title": c.value("episode_title")})
	c.from(brand)
	c.line("email.staff_episode_review_returned.heading", nil)
	c.line("email.staff_episode_review_returned.intro", map[string]any{"tenant_name": brand})
	c.line("email.staff_episode_review_returned.series", map[string]any{"series_title": c.value("series_title")})
	c.line("email.staff_episode_review_returned.episode", map[string]any{"episode_title": c.value("episode_title")})
	c.line("email.staff_episode_review_returned.comment_heading", nil)
	c.text(c.value("comment"))
	c.linkLine("email.staff_episode_review_returned.action", nil, episodeURL)
	c.linkLine("email.staff_episode_review_returned.fallback_link", nil, episodeURL)
}

// staffContactReplyCopy words the answer staff send a reader. The answer is
// the mail: nothing here introduces it, the way a reply from a person opens
// with what they wrote. The reader's own message follows it as a quotation, so
// a reader who wrote to several places can tell which question this answers.
func staffContactReplyCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	if subject := c.value("original_subject"); subject != "" {
		c.setSubject("email.staff_contact_reply.subject", map[string]any{"subject": subject})
	} else {
		c.setSubject("email.staff_contact_reply.subject_untitled", map[string]any{"tenant_name": brand})
	}
	c.from(brand)
	c.text(c.value("body"))
	c.line("email.staff_contact_reply.quote_intro", map[string]any{"received_at": c.instant("original_received_at")})
	c.text(quotePlainText(c.value("original_body")))
	c.line("email.staff_contact_reply.footnote", nil)
}

// quotePlainText marks every line of a quotation the way mail clients mark the
// message a reply answers, so the plain-text part keeps the quotation apart
// from the answer above it as the HTML part's block does.
func quotePlainText(text string) string {
	lines := strings.Split(text, "\n")
	for index, line := range lines {
		if line == "" {
			lines[index] = ">"
			continue
		}
		lines[index] = "> " + line
	}
	return strings.Join(lines, "\n")
}

// tenantAdminInvitationCopy names the role the invitation grants in the
// subject, the heading, and the body, so an invitee can tell from the mail
// alone what they are being asked to become.
func tenantAdminInvitationCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	inviteURL := c.value("invite_url")
	role := c.value("role")
	c.setSubject("email.tenant_admin_invitation.subject", map[string]any{"role": role, "tenant_name": brand})
	c.from(brand)
	c.line("email.tenant_admin_invitation.heading", map[string]any{"role": role})
	c.line("email.tenant_admin_invitation.intro", map[string]any{"tenant_name": brand})
	c.line("email.tenant_admin_invitation.body", map[string]any{"role": role, "tenant_name": brand})
	c.linkLine("email.tenant_admin_invitation.action", nil, inviteURL)
	c.line("email.tenant_admin_invitation.expires", map[string]any{"expires_at": c.instant("expires_at")})
	c.line("email.tenant_admin_invitation.ignore", nil)
	c.linkLine("email.tenant_admin_invitation.fallback_link", nil, inviteURL)
}

func readerEmailVerificationCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	verifyURL := c.value("verify_url")
	c.setSubject("email.reader_email_verification.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_email_verification.heading", nil)
	c.line("email.reader_email_verification.intro", map[string]any{"tenant_name": brand})
	c.line("email.reader_email_verification.body", nil)
	c.linkLine("email.reader_email_verification.action", nil, verifyURL)
	c.line("email.reader_email_verification.expires", map[string]any{"expires_at": c.instant("expires_at")})
	c.line("email.reader_email_verification.ignore", nil)
	c.linkLine("email.reader_email_verification.fallback_link", nil, verifyURL)
}

func readerEmailChangeConfirmationCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	confirmURL := c.value("confirm_url")
	c.setSubject("email.reader_email_change_confirmation.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_email_change_confirmation.heading", nil)
	c.line("email.reader_email_change_confirmation.intro", nil)
	if c.value("recipient_kind") == "current_email" {
		c.line("email.reader_email_change_confirmation.body_current_email", nil)
	} else {
		c.line("email.reader_email_change_confirmation.body_new_email", nil)
	}
	c.linkLine("email.reader_email_change_confirmation.action", nil, confirmURL)
	c.line("email.reader_email_change_confirmation.expires", map[string]any{"expires_at": c.instant("expires_at")})
	c.line("email.reader_email_change_confirmation.ignore", nil)
	c.line("email.reader_email_change_confirmation.current_email", map[string]any{"current_email": c.value("current_email")})
	c.line("email.reader_email_change_confirmation.new_email", map[string]any{"new_email": c.value("new_email")})
	c.linkLine("email.reader_email_change_confirmation.fallback_link", nil, confirmURL)
}

func readerEmailChangedNoticeCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	c.setSubject("email.reader_email_changed_notice.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_email_changed_notice.heading", nil)
	c.line("email.reader_email_changed_notice.body", nil)
	c.line("email.reader_email_changed_notice.previous_email", map[string]any{"previous_email": c.value("previous_email")})
	c.line("email.reader_email_changed_notice.new_email", map[string]any{"new_email": c.value("new_email")})
	c.line("email.reader_email_changed_notice.warning", nil)
}

func readerPasswordResetCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	resetURL := c.value("reset_url")
	c.setSubject("email.reader_password_reset.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_password_reset.heading", nil)
	c.line("email.reader_password_reset.intro", nil)
	c.line("email.reader_password_reset.body", nil)
	c.linkLine("email.reader_password_reset.action", nil, resetURL)
	c.line("email.reader_password_reset.expires", map[string]any{"expires_at": c.instant("expires_at")})
	c.line("email.reader_password_reset.ignore", nil)
	c.linkLine("email.reader_password_reset.fallback_link", nil, resetURL)
}

func readerPasswordChangedNoticeCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	resetURL := c.value("reset_url")
	c.setSubject("email.reader_password_changed_notice.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_password_changed_notice.heading", nil)
	c.line("email.reader_password_changed_notice.body", nil)
	c.line("email.reader_password_changed_notice.email", map[string]any{"email": c.value("email")})
	c.line("email.reader_password_changed_notice.sessions", nil)
	c.line("email.reader_password_changed_notice.warning", nil)
	c.linkLine("email.reader_password_changed_notice.action", nil, resetURL)
	c.linkLine("email.reader_password_changed_notice.fallback_link", nil, resetURL)
}

func readerSignupAttemptNoticeCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	actionURL := c.value("action_url")
	confirmed := c.value("account_state") == "confirmed"
	c.setSubject("email.reader_signup_attempt_notice.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.reader_signup_attempt_notice.heading", nil)
	c.line("email.reader_signup_attempt_notice.intro", map[string]any{"tenant_name": brand})
	if confirmed {
		c.line("email.reader_signup_attempt_notice.body_confirmed", nil)
	} else {
		c.line("email.reader_signup_attempt_notice.body_unconfirmed", nil)
	}
	c.line("email.reader_signup_attempt_notice.email", map[string]any{"email": c.value("email")})
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
	c.setSubject("email.admin_console_password_reset.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.admin_console_password_reset.heading", nil)
	c.line("email.admin_console_password_reset.intro", nil)
	c.line("email.admin_console_password_reset.body", nil)
	c.linkLine("email.admin_console_password_reset.action", nil, resetURL)
	c.line("email.admin_console_password_reset.expires", map[string]any{"expires_at": c.instant("expires_at")})
	c.line("email.admin_console_password_reset.ignore", nil)
	c.linkLine("email.admin_console_password_reset.fallback_link", nil, resetURL)
}

func adminConsoleEmailChangeConfirmationCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	confirmURL := c.value("confirm_url")
	c.setSubject("email.admin_console_email_change_confirmation.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.admin_console_email_change_confirmation.heading", nil)
	c.line("email.admin_console_email_change_confirmation.intro", nil)
	if c.value("recipient_kind") == "current_email" {
		c.line("email.admin_console_email_change_confirmation.body_current_email", nil)
	} else {
		c.line("email.admin_console_email_change_confirmation.body_new_email", nil)
	}
	c.linkLine("email.admin_console_email_change_confirmation.action", nil, confirmURL)
	c.line("email.admin_console_email_change_confirmation.expires", map[string]any{"expires_at": c.instant("expires_at")})
	c.line("email.admin_console_email_change_confirmation.ignore", nil)
	c.line("email.admin_console_email_change_confirmation.current_email", map[string]any{"current_email": c.value("current_email")})
	c.line("email.admin_console_email_change_confirmation.new_email", map[string]any{"new_email": c.value("new_email")})
	c.linkLine("email.admin_console_email_change_confirmation.fallback_link", nil, confirmURL)
}

func adminConsoleEmailChangedNoticeCopy(c *emailComposer) {
	brand := c.value("tenant_name")
	c.setSubject("email.admin_console_email_changed_notice.subject", map[string]any{"tenant_name": brand})
	c.from(brand)
	c.line("email.admin_console_email_changed_notice.heading", nil)
	c.line("email.admin_console_email_changed_notice.body", nil)
	c.line("email.admin_console_email_changed_notice.previous_email", map[string]any{"previous_email": c.value("previous_email")})
	c.line("email.admin_console_email_changed_notice.new_email", map[string]any{"new_email": c.value("new_email")})
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
	c.line("email.platform_console_password_reset.expires", map[string]any{"expires_at": c.instant("expires_at")})
	c.line("email.platform_console_password_reset.ignore", nil)
	c.linkLine("email.platform_console_password_reset.fallback_link", nil, resetURL)
}

func platformConsoleOperatorAddedCopy(c *emailComposer) {
	setPasswordURL := c.value("set_password_url")
	c.setSubject("email.platform_console_operator_added.subject", nil)
	c.from(c.message("email.layout.brand", nil))
	c.line("email.platform_console_operator_added.heading", nil)
	c.line("email.platform_console_operator_added.intro", nil)
	c.line("email.platform_console_operator_added.body", nil)
	c.linkLine("email.platform_console_operator_added.action", nil, setPasswordURL)
	c.line("email.platform_console_operator_added.expires", map[string]any{"expires_at": c.instant("expires_at")})
	c.line("email.platform_console_operator_added.expired_help", nil)
	c.line("email.platform_console_operator_added.ignore", nil)
	c.linkLine("email.platform_console_operator_added.fallback_link", nil, setPasswordURL)
}

func platformConsoleOperatorRoleGrantedCopy(c *emailComposer) {
	signInURL := c.value("sign_in_url")
	c.setSubject("email.platform_console_operator_role_granted.subject", nil)
	c.from(c.message("email.layout.brand", nil))
	c.line("email.platform_console_operator_role_granted.heading", nil)
	c.line("email.platform_console_operator_role_granted.body", nil)
	c.linkLine("email.platform_console_operator_role_granted.action", nil, signInURL)
	c.line("email.platform_console_operator_role_granted.password_help", nil)
	c.line("email.platform_console_operator_role_granted.ignore", nil)
	c.linkLine("email.platform_console_operator_role_granted.fallback_link", nil, signInURL)
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
	c.line("email.platform_console_email_change_confirmation.expires", map[string]any{"expires_at": c.instant("expires_at")})
	c.line("email.platform_console_email_change_confirmation.ignore", nil)
	c.line("email.platform_console_email_change_confirmation.current_email", map[string]any{"current_email": c.value("current_email")})
	c.line("email.platform_console_email_change_confirmation.new_email", map[string]any{"new_email": c.value("new_email")})
	c.linkLine("email.platform_console_email_change_confirmation.fallback_link", nil, confirmURL)
}

func platformConsoleEmailChangedNoticeCopy(c *emailComposer) {
	c.setSubject("email.platform_console_email_changed_notice.subject", nil)
	c.from(c.message("email.layout.brand", nil))
	c.line("email.platform_console_email_changed_notice.heading", nil)
	c.line("email.platform_console_email_changed_notice.body", nil)
	c.line("email.platform_console_email_changed_notice.previous_email", map[string]any{"previous_email": c.value("previous_email")})
	c.line("email.platform_console_email_changed_notice.new_email", map[string]any{"new_email": c.value("new_email")})
	c.line("email.platform_console_email_changed_notice.warning", nil)
}
