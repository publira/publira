package main

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformpolicy"
)

var policyGroup = commandGroup{
	name:    "policy",
	summary: "Change the platform's security policy and the community limit defaults",
	commands: []command{
		{name: "set", summary: "Save the flags given over the platform policy, keeping every other value", setup: setupPolicySet},
		{name: "show", summary: "Print the platform policy, or the built-in defaults when none is saved", setup: setupPolicyShow},
	},
}

type policySettings = platformpolicy.Policy

// limitUsage is the usage of one half of a limit on what, in window. A
// community limit is also what a tenant starts from and may loosen up to.
func limitUsage(what, window string, community bool) string {
	usage := "the `number` of " + what + " allowed in " + window
	if community {
		usage += ", the default a tenant starts from and may loosen up to"
	}
	return usage
}

func minuteDayFlags(field, flag, what string, community bool, limit func(*policySettings) *platformpolicy.MinuteDay) []fieldFlag[policySettings] {
	return []fieldFlag[policySettings]{
		{field + ".per_minute", flag + "-per-minute", limitUsage(what, "a minute", community), func(p *policySettings, v int) { limit(p).PerMinute = v }},
		{field + ".per_day", flag + "-per-day", limitUsage(what, "a day", community), func(p *policySettings, v int) { limit(p).PerDay = v }},
	}
}

func hourDayFlags(field, flag, what string, community bool, limit func(*policySettings) *platformpolicy.HourDay) []fieldFlag[policySettings] {
	return []fieldFlag[policySettings]{
		{field + ".per_hour", flag + "-per-hour", limitUsage(what, "an hour", community), func(p *policySettings, v int) { limit(p).PerHour = v }},
		{field + ".per_day", flag + "-per-day", limitUsage(what, "a day", community), func(p *policySettings, v int) { limit(p).PerDay = v }},
	}
}

// policyFlags are the numeric fields of the PlatformPolicy message.
// --mfa-required-for-tenant-admin is the one other, and is a boolean.
var policyFlags = slices.Concat(
	minuteDayFlags("password_verification", "password-verification", "password verifications of one account", false,
		func(p *policySettings) *platformpolicy.MinuteDay { return &p.PasswordVerification }),
	minuteDayFlags("store_purchase_confirmation", "store-purchase-confirmation", "in-app purchase confirmations of one reader", false,
		func(p *policySettings) *platformpolicy.MinuteDay { return &p.StorePurchaseConfirmation }),
	hourDayFlags("mail_requests_per_address", "mail-requests-per-address", "email requests for one address", false,
		func(p *policySettings) *platformpolicy.HourDay { return &p.MailRequestsPerAddress }),
	hourDayFlags("mail_requests_per_source", "mail-requests-per-source", "email requests from one source", false,
		func(p *policySettings) *platformpolicy.HourDay { return &p.MailRequestsPerSource }),
	minuteDayFlags("community_limit_defaults.comment_post", "comment-post", "comment posts by one reader", true,
		func(p *policySettings) *platformpolicy.MinuteDay { return &p.Community.CommentPost }),
	minuteDayFlags("community_limit_defaults.comment_report", "comment-report", "comment reports by one reader", true,
		func(p *policySettings) *platformpolicy.MinuteDay { return &p.Community.CommentReport }),
	minuteDayFlags("community_limit_defaults.episode_rating", "episode-rating", "episode ratings by one reader", true,
		func(p *policySettings) *platformpolicy.MinuteDay { return &p.Community.EpisodeRating }),
	hourDayFlags("community_limit_defaults.contact_message_per_account", "contact-message-per-account", "contact messages from one account", true,
		func(p *policySettings) *platformpolicy.HourDay { return &p.Community.ContactMessagePerAccount }),
	hourDayFlags("community_limit_defaults.contact_message_per_client", "contact-message-per-client", "contact messages from one client", true,
		func(p *policySettings) *platformpolicy.HourDay { return &p.Community.ContactMessagePerClient }),
	minuteDayFlags("community_limit_defaults.viewer_preferences", "viewer-preferences", "viewer preference updates by one reader", true,
		func(p *policySettings) *platformpolicy.MinuteDay { return &p.Community.ViewerPreferencesUpdate }),
	[]fieldFlag[policySettings]{{
		platformpolicy.FieldDuplicateCommentWindow, "duplicate-comment-window-minutes",
		"for how many `minutes` the same comment by one reader on one episode is refused, the default a tenant starts from and may loosen up to",
		func(p *policySettings, v int) { p.Community.DuplicateCommentWindow = time.Duration(v) * time.Minute },
	}},
)

var errNoPolicyFlag = errors.New("no value was given; name at least one with its flag")

func setupPolicySet(f *commandFlags) func(context.Context, *commandEnv) error {
	flags := declareFieldFlags(f, policyFlags)
	f.BoolFunc("mfa-required-for-tenant-admin",
		"refuse a tenant administrator with no authenticator a session on a password alone; =false stops refusing",
		func(v string) error {
			required, err := strconv.ParseBool(v)
			if err != nil {
				return err
			}
			flags.edit(func(p *policySettings) { p.MFARequiredForTenantAdmin = required })
			return nil
		})
	return func(ctx context.Context, env *commandEnv) error {
		if len(flags.edits) == 0 {
			return errNoPolicyFlag
		}
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		stored, revision, err := platformpolicy.Read(ctx, dbmodels.New(db))
		if err != nil {
			return err
		}
		params := platformpolicy.SaveParams{Policy: flags.apply(stored), ExpectedRevision: &revision}
		if err := params.Validate(); err != nil {
			return flags.named(platformpolicy.FieldPolicy, err)
		}
		saved, err := platformpolicy.Save(ctx, db, env.logger, auditlog.SystemPlatformActor, params)
		if err != nil {
			return flags.named(platformpolicy.FieldPolicy, err)
		}
		_, err = fmt.Fprintf(env.stdout, "Saved the platform policy, revision %d. Running servers apply it within %s.\n", saved.Revision, platformpolicy.CacheTTL)
		return err
	}
}

func setupPolicyShow(_ *commandFlags) func(context.Context, *commandEnv) error {
	return func(ctx context.Context, env *commandEnv) error {
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		config, found, err := platformpolicy.Get(ctx, dbmodels.New(db))
		if err != nil {
			return err
		}
		p := platformpolicy.Defaults()
		if found {
			p = platformpolicy.FromConfig(config)
		} else if _, err := fmt.Fprintln(env.stdout, "No platform policy is saved, so these built-in defaults apply"); err != nil {
			return err
		}
		mfa := "no"
		if p.MFARequiredForTenantAdmin {
			mfa = "yes"
		}
		community := p.Community
		var b strings.Builder
		fmt.Fprintf(&b, "MFA required for tenant administrators:\t%s\n", mfa)
		fmt.Fprintf(&b, "Password verifications:\t%s\n", perMinute(p.PasswordVerification))
		fmt.Fprintf(&b, "In-app purchase confirmations per reader:\t%s\n", perMinute(p.StorePurchaseConfirmation))
		fmt.Fprintf(&b, "Email requests per address:\t%s\n", perHour(p.MailRequestsPerAddress))
		fmt.Fprintf(&b, "Email requests per source:\t%s\n", perHour(p.MailRequestsPerSource))
		fmt.Fprintf(&b, "Community limit defaults:\t\n")
		fmt.Fprintf(&b, "  Comment posts:\t%s\n", perMinute(community.CommentPost))
		fmt.Fprintf(&b, "  Comment reports:\t%s\n", perMinute(community.CommentReport))
		fmt.Fprintf(&b, "  Duplicate comment window:\t%d minutes\n", int(community.DuplicateCommentWindow/time.Minute))
		fmt.Fprintf(&b, "  Episode ratings:\t%s\n", perMinute(community.EpisodeRating))
		fmt.Fprintf(&b, "  Contact messages per account:\t%s\n", perHour(community.ContactMessagePerAccount))
		fmt.Fprintf(&b, "  Contact messages per client:\t%s\n", perHour(community.ContactMessagePerClient))
		fmt.Fprintf(&b, "  Viewer preference updates:\t%s\n", perMinute(community.ViewerPreferencesUpdate))
		if found {
			fmt.Fprintf(&b, "Revision:\t%d\n", config.Revision)
			fmt.Fprintf(&b, "Updated:\t%s\n", formatTime(config.UpdatedAt))
		}
		return printTable(env.stdout, b.String())
	}
}

func perMinute(limit platformpolicy.MinuteDay) string {
	return fmt.Sprintf("%d per minute, %d per day", limit.PerMinute, limit.PerDay)
}

func perHour(limit platformpolicy.HourDay) string {
	return fmt.Sprintf("%d per hour, %d per day", limit.PerHour, limit.PerDay)
}
