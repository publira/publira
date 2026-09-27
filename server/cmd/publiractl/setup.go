package main

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/platformsmtp"
	"github.com/publira/publira/server/internal/platformstorage"
	"github.com/publira/publira/server/internal/platformtenants"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/storagesettings"
	"github.com/publira/publira/server/internal/tenantmembers"
	"github.com/publira/publira/server/internal/tenantorigin"
	"github.com/publira/publira/server/internal/tenanttz"
	"github.com/publira/publira/server/internal/webpushsettings"
)

// setupCommand brings an install from an empty database to a tenant an
// administrator can sign in to. It holds the prompts and the order of the
// steps; every write goes through the package the step's own command uses.
var setupCommand = command{
	name:    "setup",
	summary: "Set up an install: the platform defaults, the object store, SMTP, Web Push, a tenant, and its first administrator",
	setup:   setupSetup,
}

// setupFlags are setup's flags. A flag keeps the spelling of the command that
// saves the same value, unless another step's command spells one alike: those
// carry their step as a prefix.
type setupFlags struct {
	nonInteractive bool

	defaultLocale, defaultTimezone string

	storage         storagesettings.Settings
	accessKeyID     string
	secretAccessKey *secret

	smtp         emailsettings.SMTPSettings
	smtpPort     string
	smtpPassword *secret
	smtpTestTo   string

	subject string

	tenantName, domain, adminDomain, tenantTimezone, tenantDefaultLocale string

	adminEmail, adminName string
	adminPassword         *secret
	generateAdminPassword bool
}

func setupSetup(f *commandFlags) func(context.Context, *commandEnv) error {
	fl := &setupFlags{}
	f.BoolVar(&fl.nonInteractive, "non-interactive", false, "ask for nothing, and exit 2 naming the first required value no flag gives and nothing saved holds")

	f.StringVar(&fl.defaultLocale, "default-locale", "", "the platform's language, one of "+strings.Join(locale.Supported, ", "))
	f.StringVar(&fl.defaultTimezone, "default-timezone", "", "the IANA time zone new tenants start on (default \""+tenanttz.Default+"\")")

	f.StringVar(&fl.storage.Bucket, "bucket", "", "the bucket images are stored in")
	f.StringVar(&fl.storage.Region, "region", "", "the bucket's region")
	f.StringVar(&fl.storage.Endpoint, "endpoint", "", "the store's URL, for a store other than Amazon S3")
	f.BoolVar(&fl.storage.ForcePathStyle, "force-path-style", false, "address the bucket in the URL path rather than the host name")
	f.StringVar(&fl.storage.PublicBaseURL, "public-base-url", "", "the URL stored objects are readable from, when something serves them directly")
	f.StringVar(&fl.accessKeyID, "access-key-id", "", "the access key requests are signed with; left out, every process signs with its own AWS credential")
	fl.secretAccessKey = f.Secret("secret-access-key", "secret access key")

	f.StringVar(&fl.smtp.Host, "host", "", "the SMTP server's host")
	f.StringVar(&fl.smtpPort, "port", "", "the SMTP server's port `number`")
	f.StringVar(&fl.smtp.Encryption, "encryption", "", "how the SMTP connection is encrypted, one of tls, starttls, none")
	f.StringVar(&fl.smtp.Username, "username", "", "the user the SMTP server is signed in to as")
	f.StringVar(&fl.smtp.FromAddress, "from-address", "", "the address the platform's mail is sent from")
	f.StringVar(&fl.smtp.ReplyTo, "reply-to", "", "the address replies go to, if not the sender's")
	fl.smtpPassword = f.Secret("smtp-password", "SMTP password")
	f.StringVar(&fl.smtpTestTo, "smtp-test-to", "", "an address to send a test message to once the SMTP settings are saved")

	f.StringVar(&fl.subject, "subject", "", "the Web Push subject, a mailto: URI or an https: URL; left out, Web Push stays off")

	f.StringVar(&fl.tenantName, "tenant-name", "", "the tenant's name")
	f.StringVar(&fl.domain, "domain", "", "the host the tenant's site is served on")
	f.StringVar(&fl.adminDomain, "admin-domain", "", "the host the tenant's console is served on, if not admin.<domain>")
	f.StringVar(&fl.tenantTimezone, "tenant-timezone", "", "the IANA time zone the tenant starts on, if not the platform's")
	f.StringVar(&fl.tenantDefaultLocale, "tenant-default-locale", "", "the tenant's language, if not the platform's")

	f.StringVar(&fl.adminEmail, "admin-email", "", "the address the first administrator signs in with")
	f.StringVar(&fl.adminName, "admin-name", "", "the name the console shows for the first administrator")
	fl.adminPassword = f.Secret("admin-password", "administrator password")
	f.BoolVar(&fl.generateAdminPassword, "generate-admin-password", false, "generate the administrator's password and print it once in the summary")

	return func(ctx context.Context, env *commandEnv) error {
		given := map[string]bool{}
		f.Visit(func(fl *flag.Flag) { given[fl.Name] = true })
		// Every audit entry is still written to the database; the log line
		// that mirrors it would only interleave with the prompts.
		env.logger = logging.New(env.console.stderr, &slog.HandlerOptions{Level: slog.LevelWarn})
		r := &setupRun{
			env:         env,
			flags:       fl,
			given:       given,
			interactive: !fl.nonInteractive && env.console.isTerminal(),
			in:          bufio.NewReader(env.console.stdin),
		}
		return r.run(ctx)
	}
}

// setupRun is one run of setup: what it was given and what each step did.
type setupRun struct {
	env         *commandEnv
	flags       *setupFlags
	given       map[string]bool
	interactive bool
	in          *bufio.Reader

	db      *sql.DB
	secrets *secretcrypto.Manager

	steps             strings.Builder
	platformLocale    string
	platformTimezone  string
	tenant            dbmodels.Tenant
	generatedPassword string
}

// The outcome of a step as the summary names it.
const (
	outcomeCreated = "created"
	outcomeUpdated = "updated"
	outcomeKept    = "kept"
	outcomeSkipped = "skipped"
)

// outcome names what a save did to a row that had revision before, or none.
func outcome(found bool, before, after int64) string {
	switch {
	case !found:
		return outcomeCreated
	case before == after:
		return outcomeKept
	default:
		return outcomeUpdated
	}
}

func (r *setupRun) run(ctx context.Context) error {
	if r.flags.generateAdminPassword && r.flags.adminPassword.given() {
		return fmt.Errorf("--generate-admin-password and %s cannot both be given", r.flags.adminPassword.source())
	}
	// SMTP always stores a password, so a run that could not encrypt one
	// stops here with nothing written.
	secrets, err := r.env.secretManager()
	if err != nil {
		return err
	}
	r.secrets = secrets
	db, err := r.env.openPlatformDB()
	if err != nil {
		return err
	}
	defer db.Close() //nolint:errcheck
	r.db = db

	for _, step := range []func(context.Context) error{r.platformStep, r.storageStep, r.smtpStep, r.webPushStep, r.tenantStep} {
		if err := step(ctx); err != nil {
			return err
		}
	}
	return r.adminStep(ctx)
}

// done records what a step did, and reports it on stderr as it happens so an
// interrupted run shows how far it got.
func (r *setupRun) done(step, outcome, detail string) {
	fmt.Fprintf(&r.steps, "%s\t%s\t%s\n", step, outcome, detail)
	_, _ = fmt.Fprintf(r.env.console.stderr, "%s: %s %s\n", step, outcome, detail)
}

// anyGiven reports whether any of the flags names was given.
func (r *setupRun) anyGiven(names ...string) bool {
	for _, name := range names {
		if r.given[name] {
			return true
		}
	}
	return false
}

// ask prints label with def offered and reads one line, def when it is blank.
func (r *setupRun) ask(label, def string) (string, error) {
	prompt := label
	if def != "" {
		prompt += " [" + def + "]"
	}
	_, _ = fmt.Fprintf(r.env.console.stderr, "%s: ", prompt)
	line, err := r.in.ReadString('\n')
	switch {
	case err == nil, errors.Is(err, io.EOF) && line != "":
	case errors.Is(err, io.EOF):
		_, _ = io.WriteString(r.env.console.stderr, "\n")
		return "", fmt.Errorf("stdin closed before %q was answered", label)
	default:
		return "", err
	}
	if answer := strings.TrimSpace(line); answer != "" {
		return answer, nil
	}
	return def, nil
}

// confirm asks a yes or no question, def when the answer is blank.
func (r *setupRun) confirm(label string, def bool) (bool, error) {
	options := "y/N"
	if def {
		options = "Y/n"
	}
	for {
		answer, err := r.ask(label+" ["+options+"]", "")
		if err != nil {
			return false, err
		}
		switch strings.ToLower(answer) {
		case "":
			return def, nil
		case "y", "yes":
			return true, nil
		case "n", "no":
			return false, nil
		}
		_, _ = io.WriteString(r.env.console.stderr, "Answer y or n.\n")
	}
}

// value is the value of the flag name when it was given, else the terminal's
// answer with def offered, else def. A required value that is still empty is
// asked for again, or missing where there is no terminal to ask on.
func (r *setupRun) value(name, label, flagValue, def string, required bool) (string, error) {
	if r.given[name] {
		return flagValue, nil
	}
	if !r.interactive {
		if required && def == "" {
			return "", &missingValueError{flags: "--" + name}
		}
		return def, nil
	}
	for {
		answer, err := r.ask(label, def)
		if err != nil || answer != "" || !required {
			return answer, err
		}
		_, _ = fmt.Fprintf(r.env.console.stderr, "%s is required.\n", label)
	}
}

// readSecret reads s from its flag, else asks for it on the terminal, and
// reports it missing where there is neither.
func (r *setupRun) readSecret(s *secret) (string, error) {
	if !s.given() && !r.interactive {
		return "", &missingValueError{flags: "--" + s.name + "-file or --" + s.name + "-stdin"}
	}
	return s.read(r.env.console)
}

// named names the setup flag behind what a package refused, from flags, which
// maps the refused field to the flag.
func named(err error, flags map[string]string) error {
	if flag := flags[fielderr.Field(err)]; flag != "" {
		return fmt.Errorf("%s: %w", flag, err)
	}
	return err
}

func (r *setupRun) platformStep(ctx context.Context) error {
	stored, found, err := platformconfig.Get(ctx, dbmodels.New(r.db))
	if err != nil {
		return err
	}
	if found && !r.anyGiven("default-locale", "default-timezone") {
		r.platformLocale, r.platformTimezone = stored.DefaultLocale, stored.DefaultTimezone
		r.done("Platform defaults", outcomeKept, stored.DefaultLocale+", "+stored.DefaultTimezone)
		return nil
	}
	defLocale, defTimezone := "", tenanttz.Default
	if found {
		defLocale, defTimezone = stored.DefaultLocale, stored.DefaultTimezone
	}
	params := platformconfig.SaveParams{}
	if params.DefaultLocale, err = r.value("default-locale", "Default locale ("+strings.Join(locale.Supported, ", ")+")", r.flags.defaultLocale, defLocale, true); err != nil {
		return err
	}
	if params.DefaultTimezone, err = r.value("default-timezone", "Default time zone", r.flags.defaultTimezone, defTimezone, true); err != nil {
		return err
	}
	saved, err := platformconfig.Save(ctx, r.db, r.env.logger, auditlog.SystemPlatformActor, params)
	if err != nil {
		return named(err, platformFlags)
	}
	r.platformLocale, r.platformTimezone = saved.DefaultLocale, saved.DefaultTimezone
	r.done("Platform defaults", outcome(found, stored.Revision, saved.Revision), saved.DefaultLocale+", "+saved.DefaultTimezone)
	return nil
}

func (r *setupRun) storageStep(ctx context.Context) error {
	q := dbmodels.New(r.db)
	stored, found, err := platformstorage.Get(ctx, q)
	if err != nil {
		return err
	}
	secret := r.flags.secretAccessKey
	if found && !r.anyGiven("bucket", "region", "endpoint", "force-path-style", "public-base-url", "access-key-id") && !secret.given() {
		r.done("Object store", outcomeKept, stored.Bucket)
		return nil
	}

	var base storagesettings.Stored
	if found {
		base = storagesettings.FromConfig(stored)
	}
	flags, settings := r.flags, base.Settings
	if settings.Bucket, err = r.value("bucket", "Bucket", flags.storage.Bucket, base.Settings.Bucket, true); err != nil {
		return err
	}
	if settings.Region, err = r.value("region", "Region", flags.storage.Region, base.Settings.Region, true); err != nil {
		return err
	}
	if settings.Endpoint, err = r.value("endpoint", "Endpoint (blank for Amazon S3)", flags.storage.Endpoint, base.Settings.Endpoint, false); err != nil {
		return err
	}
	switch {
	case r.given["force-path-style"]:
		settings.ForcePathStyle = flags.storage.ForcePathStyle
	case r.interactive:
		if settings.ForcePathStyle, err = r.confirm("Address the bucket in the URL path, as most self-hosted stores need?", base.Settings.ForcePathStyle); err != nil {
			return err
		}
	}
	if settings.PublicBaseURL, err = r.value("public-base-url", "Public base URL (blank when nothing serves stored objects directly)", flags.storage.PublicBaseURL, base.Settings.PublicBaseURL, false); err != nil {
		return err
	}
	accessKeyID, err := r.value("access-key-id", "Access key ID (blank signs with each process's own AWS credential)", flags.accessKeyID, base.AccessKeyID, false)
	if err != nil {
		return err
	}

	params := platformstorage.SaveParams{Settings: settings, AccessKeyID: strings.TrimSpace(accessKeyID), SecretMode: secretupdate.Clear}
	nameStorage := func(err error) error {
		return secret.refusal(err, storagesettings.FieldSecretAccessKey, storageError)
	}
	switch {
	case params.AccessKeyID == "" && secret.given():
		return nameStorage(storagesettings.ValidateCredentialPair("", true))
	case params.AccessKeyID == "":
	case !secret.given() && base.HasSecretAccessKey && base.AccessKeyID == params.AccessKeyID:
		params.SecretMode = secretupdate.Unchanged
	default:
		if params.SecretAccessKey, err = r.readSecret(secret); err != nil {
			return err
		}
		params.SecretMode = secretupdate.Replace
	}

	// The store is tested before it is saved, and only when it changes, so a
	// refused store is never saved and a finished install files no test.
	changes, err := platformstorage.Changes(ctx, q, r.secrets, params)
	if err != nil {
		return nameStorage(err)
	}
	if !changes {
		r.done("Object store", outcomeKept, stored.Bucket)
		return nil
	}
	tester := platformstorage.Tester{Encryptor: r.secrets, Store: s3storage.NewConnectionTester(), Recorder: auditlog.New(q, r.env.logger)}
	checks, err := tester.Test(ctx, q, auditlog.SystemPlatformActor, platformstorage.TestParams{
		Settings:        params.Settings,
		AccessKeyID:     params.AccessKeyID,
		SecretMode:      params.SecretMode,
		SecretAccessKey: params.SecretAccessKey,
	})
	if err != nil {
		return nameStorage(err)
	}
	if err := printStorageChecks(r.env.console.stderr, checks); err != nil {
		return fmt.Errorf("%w; nothing was saved", err)
	}
	saved, err := platformstorage.Save(ctx, r.db, r.env.logger, r.secrets, auditlog.SystemPlatformActor, params)
	if err != nil {
		return nameStorage(err)
	}
	r.done("Object store", outcome(found, stored.Revision, saved.Revision), saved.Bucket)
	return nil
}

func (r *setupRun) smtpStep(ctx context.Context) error {
	q := dbmodels.New(r.db)
	stored, found, err := platformsmtp.Get(ctx, q)
	if err != nil {
		return err
	}
	password := r.flags.smtpPassword
	if found && !r.anyGiven("host", "port", "encryption", "username", "from-address", "reply-to") && !password.given() {
		r.done("SMTP", outcomeKept, stored.Host+":"+strconv.Itoa(int(stored.Port)))
		return nil
	}

	var base emailsettings.SMTPSettings
	port := ""
	if found {
		base = emailsettings.SMTPSettings{Host: stored.Host, Username: stored.Username, Encryption: stored.Encryption, FromAddress: stored.FromAddress, ReplyTo: stored.ReplyTo.String}
		port = strconv.Itoa(int(stored.Port))
	}
	flags, settings := r.flags, base
	if settings.Host, err = r.value("host", "SMTP host", flags.smtp.Host, base.Host, true); err != nil {
		return err
	}
	if port, err = r.value("port", "SMTP port", flags.smtpPort, port, true); err != nil {
		return err
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(port), 10, 32)
	if err != nil {
		return fmt.Errorf("--port: %w", errNotAWholeNumber)
	}
	settings.Port = int32(parsed)
	if settings.Encryption, err = r.value("encryption", "SMTP encryption (tls, starttls, none)", flags.smtp.Encryption, base.Encryption, true); err != nil {
		return err
	}
	if settings.Username, err = r.value("username", "SMTP username", flags.smtp.Username, base.Username, true); err != nil {
		return err
	}
	if settings.FromAddress, err = r.value("from-address", "Address mail is sent from", flags.smtp.FromAddress, base.FromAddress, true); err != nil {
		return err
	}
	if settings.ReplyTo, err = r.value("reply-to", "Address replies go to (blank for the sender)", flags.smtp.ReplyTo, base.ReplyTo, false); err != nil {
		return err
	}

	params := platformsmtp.SaveParams{Settings: settings, PasswordMode: secretupdate.Unchanged}
	nameSMTP := func(err error) error {
		return password.refusal(err, emailsettings.FieldPassword, func(err error) error { return smtpError(err, false) })
	}
	if err := params.Validate(); err != nil {
		return nameSMTP(err)
	}
	if password.given() || !found || !platformsmtp.HasPassword(stored) {
		if params.Password, err = r.readSecret(password); err != nil {
			return err
		}
		params.PasswordMode = secretupdate.Replace
	}
	saved, err := platformsmtp.Save(ctx, r.db, r.env.logger, r.secrets, auditlog.SystemPlatformActor, params)
	if err != nil {
		return nameSMTP(err)
	}
	result := outcome(found, stored.Revision, saved.Revision)
	detail := saved.Host + ":" + strconv.Itoa(int(saved.Port))
	if result == outcomeKept {
		r.done("SMTP", result, detail)
		return nil
	}

	// A test message is sent only for settings this run saved, so a run on a
	// finished install sends nothing.
	to, err := r.value("smtp-test-to", "Send a test message to (blank skips it)", flags.smtpTestTo, "", false)
	if err != nil {
		return err
	}
	if to = strings.TrimSpace(to); to != "" {
		tester := platformsmtp.Tester{Encryptor: r.secrets, SMTP: internalsmtp.NewClient(), Recorder: auditlog.New(q, r.env.logger)}
		if err := tester.SendSaved(ctx, q, auditlog.SystemPlatformActor, to); err != nil {
			if fielderr.Field(err) == platformsmtp.FieldRecipientEmail {
				return fmt.Errorf("--smtp-test-to: %w", err)
			}
			return fmt.Errorf("the SMTP settings were saved, but %w; correct them with publiractl smtp set and try again with publiractl smtp test", err)
		}
		detail += ", test message sent to " + to
	}
	r.done("SMTP", result, detail)
	return nil
}

func (r *setupRun) webPushStep(ctx context.Context) error {
	stored, found, err := webpushsettings.Get(ctx, dbmodels.New(r.db))
	if err != nil {
		return err
	}
	if !r.given["subject"] && found && webpushsettings.FromConfig(stored).Configured() {
		r.done("Web Push", outcomeKept, stored.Subject.String)
		return nil
	}
	setUp := r.given["subject"]
	if !setUp && r.interactive {
		if setUp, err = r.confirm("Set up Web Push, the browser notifications the platform sends?", false); err != nil {
			return err
		}
	}
	if !setUp {
		r.done("Web Push", outcomeSkipped, "publiractl webpush init turns it on")
		return nil
	}
	subject, err := r.value("subject", "Web Push subject (a mailto: URI or an https: URL)", r.flags.subject, "", true)
	if err != nil {
		return err
	}
	saved, err := webpushsettings.SaveSubject(ctx, r.db, r.env.logger, r.secrets, auditlog.SystemPlatformActor, webpushsettings.SaveParams{Subject: subject})
	if err != nil {
		return webPushError(err)
	}
	r.done("Web Push", outcome(found, stored.Revision, saved.Revision), saved.Subject.String)
	return nil
}

// setupTenantFlags names the setup flag each field a tenant is refused over
// is given through.
var setupTenantFlags = map[string]string{
	platformtenants.FieldName:          "--tenant-name",
	platformtenants.FieldDomain:        "--domain",
	platformtenants.FieldAdminDomain:   "--admin-domain",
	platformtenants.FieldDefaultLocale: "--tenant-default-locale",
	platformtenants.FieldTimezone:      "--tenant-timezone",
}

func (r *setupRun) tenantStep(ctx context.Context) error {
	q := dbmodels.New(r.db)
	// An install with one tenant is taken to be setting that one up.
	sole, _, err := platformtenants.Sole(ctx, q)
	if err != nil {
		return err
	}
	domain, err := r.value("domain", "Tenant site domain", r.flags.domain, sole.Domain, true)
	if err != nil {
		return err
	}
	existing, err := platformtenants.Find(ctx, q, domain)
	switch {
	case err == nil:
		r.tenant = existing
		r.done("Tenant", outcomeKept, existing.Name+" ("+existing.Domain+")")
		return nil
	case !errors.Is(err, platformtenants.ErrNotFound):
		return named(err, map[string]string{platformtenants.FieldTenant: "--domain"})
	}

	params := platformtenants.CreateParams{Domain: domain}
	if params.Name, err = r.value("tenant-name", "Tenant name", r.flags.tenantName, "", true); err != nil {
		return err
	}
	if params.AdminDomain, err = r.value("admin-domain", "Tenant console domain (blank for admin."+strings.TrimSpace(domain)+")", r.flags.adminDomain, "", false); err != nil {
		return err
	}
	if params.Timezone, err = r.value("tenant-timezone", "Tenant time zone", r.flags.tenantTimezone, r.platformTimezone, false); err != nil {
		return err
	}
	if params.DefaultLocale, err = r.value("tenant-default-locale", "Tenant default locale", r.flags.tenantDefaultLocale, r.platformLocale, true); err != nil {
		return err
	}
	creation, err := params.Validate()
	if err != nil {
		return named(err, setupTenantFlags)
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	created, err := platformtenants.Create(ctx, tx, r.env.logger, auditlog.SystemPlatformActor, creation)
	if err != nil {
		return named(err, setupTenantFlags)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	r.tenant = created.Tenant
	r.done("Tenant", outcomeCreated, created.Tenant.Name+" ("+created.Tenant.Domain+")")
	return nil
}

// setupAdminFlags names the setup flag each field an administrator is refused
// over is given through.
var setupAdminFlags = map[string]string{
	tenantmembers.FieldEmail: "--admin-email",
	tenantmembers.FieldName:  "--admin-name",
}

// adminStep is the last step, so it prints the summary. An administrator it
// creates is committed only once the summary holding a generated password has
// been printed, so no account is left whose password nobody saw.
func (r *setupRun) adminStep(ctx context.Context) error {
	q := dbmodels.New(r.db)
	if !r.given["admin-email"] {
		admin, found, err := tenantmembers.FirstAdmin(ctx, q, r.tenant.ID)
		if err != nil {
			return err
		}
		if found {
			r.done("First administrator", outcomeKept, admin.Email)
			return r.printSummary()
		}
	}
	email, err := r.value("admin-email", "Administrator email", r.flags.adminEmail, "", true)
	if err != nil {
		return err
	}
	existing, found, err := tenantmembers.FindByEmail(ctx, q, r.tenant.ID, email)
	if err != nil {
		return named(err, setupAdminFlags)
	}
	// An address that already signs in to the tenant is kept only when it can
	// administer it; anything less would report a tenant nobody can manage as
	// set up.
	if found {
		if existing.Role != auth.RoleTenantAdmin {
			role := existing.Role
			if role == "" {
				role = "no console role"
			}
			return fmt.Errorf("--admin-email: %s is a user of the tenant with %s, not %s; give it the role with publiractl tenant member, or name another address",
				existing.Email, role, auth.RoleTenantAdmin)
		}
		r.done("First administrator", outcomeKept, existing.Email)
		return r.printSummary()
	}

	params := tenantmembers.AccountParams{TenantID: r.tenant.ID, Email: email, Role: auth.RoleTenantAdmin}
	if params.Name, err = r.value("admin-name", "Administrator name", r.flags.adminName, "", true); err != nil {
		return err
	}
	if params.Password, err = r.adminPassword(); err != nil {
		return err
	}
	if err := params.Validate(); err != nil {
		return r.flags.adminPassword.refusal(err, tenantmembers.FieldPassword, func(err error) error { return named(err, setupAdminFlags) })
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	member, err := platformtenants.CreateAccount(ctx, tx, r.env.logger, auditlog.SystemPlatformActor, params)
	if err != nil {
		return named(err, setupAdminFlags)
	}
	r.done("First administrator", outcomeCreated, member.Email)
	if err := r.printSummary(); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w; the administrator was not created", err)
	}
	return nil
}

// adminPassword is the new administrator's password: generated, read from
// its flag, or typed twice at the terminal.
func (r *setupRun) adminPassword() (string, error) {
	flags := r.flags
	generate := flags.generateAdminPassword
	if !generate && !flags.adminPassword.given() {
		if !r.interactive {
			return "", &missingValueError{flags: "--admin-password-file, --admin-password-stdin, or --generate-admin-password"}
		}
		var err error
		if generate, err = r.confirm("Generate the administrator's password?", true); err != nil {
			return "", err
		}
	}
	if generate {
		password, err := generatePassword()
		r.generatedPassword = password
		return password, err
	}
	password, err := flags.adminPassword.read(r.env.console)
	if err != nil || flags.adminPassword.given() {
		return password, err
	}
	again := &secret{name: flags.adminPassword.name, label: "administrator password again"}
	repeated, err := again.read(r.env.console)
	if err != nil {
		return "", err
	}
	if repeated != password {
		return "", errors.New("the two administrator passwords do not match")
	}
	return password, nil
}

// printSummary prints what every step did, where the tenant is served, and a
// generated password, the one place it is ever shown.
func (r *setupRun) printSummary() error {
	var b strings.Builder
	b.WriteString(r.steps.String())
	site, err := tenantorigin.Site(r.tenant)
	if err != nil {
		return err
	}
	console, err := tenantorigin.AdminConsole(r.tenant)
	if err != nil {
		return err
	}
	fmt.Fprintf(&b, "\nTenant site:\t%s\n", site)
	fmt.Fprintf(&b, "Tenant console:\t%s\n", console)
	if r.generatedPassword != "" {
		fmt.Fprintf(&b, "Administrator password:\t%s\n", r.generatedPassword)
	}
	return printTable(r.env.stdout, b.String())
}
