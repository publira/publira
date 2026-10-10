package main

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"strings"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/sqldb"
)

// commandGroup is a group of commands, dispatched by the word that names it. A
// group can hold groups of its own, dispatched by the next word.
type commandGroup struct {
	name     string
	summary  string
	commands []command
	groups   []commandGroup
	// synopsis follows the group's words on its usage line, and is
	// "<command> [flags]" when empty.
	synopsis string
	// heading titles the list of commands in the usage, and is "Commands" when
	// empty.
	heading string
	// note closes the usage with what every command in the group shares.
	note string
}

// command is one subcommand of a commandGroup. setup declares its flags and
// returns what runs once they have been parsed; a returned error is a failure
// the command reports, and exits 1.
type command struct {
	name    string
	summary string
	setup   func(f *commandFlags) func(ctx context.Context, env *commandEnv) error
}

// rootGroup is what the first argument is looked up in.
var rootGroup = commandGroup{
	synopsis: "<command>",
	commands: []command{setupCommand},
	groups:   groups,
}

var groups = []commandGroup{dbGroup, jobGroup, operatorGroup, platformGroup, policyGroup, retentionGroup, searchGroup, smtpGroup, storageGroup, tenantGroup, webPushGroup}

// commandFlags is the flag set of one command, with the secrets it declared.
type commandFlags struct {
	*flag.FlagSet
	secrets []*secret
}

// commandEnv is what every command runs with. Its logger writes to stderr; a
// command whose log is its output, as db's and job's are, logs to stdout
// instead.
type commandEnv struct {
	console console
	stdout  io.Writer
	logger  *slog.Logger
}

// defaultPlatformDBURL is publira_platform in the development database, the
// same fallback publira server uses for PUBLIRA_PLATFORM_DB_URL.
const defaultPlatformDBURL = "postgres://publira_platform:platformpass@db:5432/publira?sslmode=disable"

// platformDBURL is the connection every settings and provisioning command
// opens: they write the platform_* tables and the tenant rows, which is what
// publira_platform and its BYPASSRLS exist for. Unlike the job group's chains
// it never ends at PUBLIRA_DB_URL, so a forgotten variable fails to
// authenticate instead of writing as the superuser.
func platformDBURL() string {
	return resolveDBURL(defaultPlatformDBURL, "PUBLIRA_PLATFORM_DB_URL")
}

func (e *commandEnv) openPlatformDB() (*sql.DB, error) {
	return sqldb.Open(platformDBURL())
}

// errNoEncryptionKeys stops a command that has a secret to store on an install
// whose servers could not decrypt it.
var errNoEncryptionKeys = errors.New("PUBLIRA_SECRET_ENCRYPTION_KEYS is not set; a stored secret is encrypted with the keys the servers decrypt it with")

// secretManager encrypts a secret for storage with the keys config.New()
// resolves, which are the ones the servers read. A command calls it before it
// writes anything, so a missing key stops it with nothing changed; a command
// that stores no secret never reads the keys.
func (e *commandEnv) secretManager() (*secretcrypto.Manager, error) {
	cfg, err := config.New()
	if err != nil {
		return nil, err
	}
	if len(cfg.Encryption.Keys) == 0 {
		return nil, errNoEncryptionKeys
	}
	return secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
}

// runGroup dispatches args through g. It exits 0 on success, 1 on a failure
// the command reports, and 2 on a usage error, with the usage text on stderr.
func runGroup(g *commandGroup, args []string, con console, stdout io.Writer) int {
	stderr := con.stderr
	if len(args) == 0 {
		return usageError(stderr, "a "+g.words("command")+" is required", g.usage())
	}
	for _, sub := range g.groups {
		if sub.name == args[0] {
			sub.name = g.words(sub.name)
			return runGroup(&sub, args[1:], con, stdout)
		}
	}
	for i := range g.commands {
		if g.commands[i].name == args[0] {
			return runCommand(g, &g.commands[i], args[1:], con, stdout)
		}
	}
	return usageError(stderr, fmt.Sprintf("unknown %s %q", g.words("command"), args[0]), g.usage())
}

// words prefixes word with the words that invoke g.
func (g *commandGroup) words(word string) string {
	if g.name == "" {
		return word
	}
	return g.name + " " + word
}

// runCommand runs c, a command of g, with its flags in args. It exits as
// runGroup does.
func runCommand(g *commandGroup, c *command, args []string, con console, stdout io.Writer) int {
	stderr := con.stderr
	name := g.words(c.name)
	f := &commandFlags{FlagSet: flag.NewFlagSet(name, flag.ContinueOnError)}
	f.SetOutput(io.Discard)
	run := c.setup(f)
	usage := commandUsage(name, c, f)
	err := f.Parse(args)
	if errors.Is(err, flag.ErrHelp) {
		_, _ = io.WriteString(stderr, usage)
		return 0
	}
	// A command that declares no flags takes no arguments, and is refused with
	// its group's usage, since its own is only its summary.
	if !f.declared() && len(args) > 0 {
		return usageError(stderr, name+" takes no arguments", g.usage())
	}
	if err != nil {
		return usageError(stderr, flagError(err), usage)
	}
	// A positional argument is refused without being repeated: it may be a
	// secret typed where a flag was meant.
	if f.NArg() > 0 {
		return usageError(stderr, name+" takes no positional arguments", usage)
	}
	if err := f.checkSecretSources(); err != nil {
		return usageError(stderr, err.Error(), usage)
	}

	env := &commandEnv{
		console: con,
		stdout:  stdout,
		logger:  logging.New(stderr, &slog.HandlerOptions{Level: slog.LevelInfo}),
	}
	if err := run(context.Background(), env); err != nil {
		if errors.Is(err, errLogged) {
			return 1
		}
		var missing *missingValueError
		if errors.As(err, &missing) {
			_, _ = io.WriteString(stderr, "publiractl: "+err.Error()+"\n")
			return 2
		}
		return commandError(stderr, err)
	}
	return 0
}

// missingValueError is a value a command needs and has no way to get: no flag
// gave it, nothing is saved, and there is no terminal to ask on. It exits 2,
// as a usage error does.
type missingValueError struct {
	flags string
}

func (e *missingValueError) Error() string {
	return e.flags + " is required; give it as a flag, or run on a terminal without --non-interactive to be asked for it"
}

// errLogged is a failure the command has already logged, so it exits 1
// without repeating it.
var errLogged = errors.New("the failure is logged")

// commandError reports a failure the command ran into and returns its exit
// status.
func commandError(w io.Writer, err error) int {
	_, _ = io.WriteString(w, "publiractl: "+err.Error()+"\n")
	return 1
}

func (g *commandGroup) usage() string {
	synopsis := cmp.Or(g.synopsis, "<command> [flags]")
	heading := cmp.Or(g.heading, "Commands")
	var b strings.Builder
	fmt.Fprintf(&b, "\nUsage: publiractl %s\n\n%s:\n", g.words(synopsis), heading)
	for _, c := range g.commands {
		fmt.Fprintf(&b, "  %-25s %s\n", c.name, c.summary)
	}
	for _, sub := range g.groups {
		fmt.Fprintf(&b, "  %-25s %s\n", sub.name, sub.summary)
	}
	if g.note != "" {
		b.WriteString("\n" + g.note + "\n")
	}
	return b.String()
}

// declared reports whether the command declared any flag.
func (f *commandFlags) declared() bool {
	declared := false
	f.VisitAll(func(*flag.Flag) { declared = true })
	return declared
}

func commandUsage(name string, c *command, f *commandFlags) string {
	var b strings.Builder
	fmt.Fprintf(&b, "\nUsage: publiractl %s", name)
	if f.declared() {
		b.WriteString(" [flags]")
	}
	fmt.Fprintf(&b, "\n\n%s\n", c.summary)
	var flags strings.Builder
	f.VisitAll(func(fl *flag.Flag) {
		typeName, usage := flag.UnquoteUsage(fl)
		fmt.Fprintf(&flags, "  --%s", fl.Name)
		if typeName != "" {
			fmt.Fprintf(&flags, " %s", typeName)
		}
		fmt.Fprintf(&flags, "\n    \t%s", usage)
		if fl.DefValue != "" && fl.DefValue != "false" {
			fmt.Fprintf(&flags, " (default %q)", fl.DefValue)
		}
		flags.WriteString("\n")
	})
	if flags.Len() > 0 {
		b.WriteString("\nFlags:\n" + flags.String())
	}
	if len(f.secrets) > 0 {
		b.WriteString("\nA secret is read from a masked prompt, from stdin with its --*-stdin flag,\none per invocation, or from a file with its --*-file flag. It is never taken\nas an argument.\n")
	}
	for _, s := range f.secrets {
		if s.keepable {
			fmt.Fprintf(&b, "The saved %[1]s is kept when it is left blank at the prompt,\nor when stdin is not a terminal and neither --%[2]s-stdin nor --%[2]s-file\nis given.\n", s.label, s.name)
		}
	}
	return b.String()
}

// flagSpellings are the places the flag package names a flag in its errors,
// always with one dash.
var flagSpellings = []string{"flag provided but not defined: -", "flag needs an argument: -", " for flag -", " for -"}

// flagError is what f.Parse refused, naming the flag with the two dashes the
// usage and every other message spell it with.
func flagError(err error) string {
	msg := err.Error()
	for _, spelling := range flagSpellings {
		msg = strings.Replace(msg, spelling, spelling+"-", 1)
	}
	return msg
}
