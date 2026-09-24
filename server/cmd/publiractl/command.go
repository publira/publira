package main

import (
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

// commandGroup is a group of the settings and provisioning commands, which
// write the platform_* tables and the tenant rows in place of the Platform
// Console.
type commandGroup struct {
	name     string
	summary  string
	commands []command
}

// command is one subcommand of a commandGroup. setup declares its flags and
// returns what runs once they have been parsed; a returned error is a failure
// the command reports, and exits 1.
type command struct {
	name    string
	summary string
	setup   func(f *commandFlags) func(ctx context.Context, env *commandEnv) error
}

// groups are the settings and provisioning command groups, dispatched beside db
// and job.
var groups []commandGroup

func lookupGroup(name string) *commandGroup {
	for i := range groups {
		if groups[i].name == name {
			return &groups[i]
		}
	}
	return nil
}

// commandFlags is the flag set of one command, with the secrets it declared.
type commandFlags struct {
	*flag.FlagSet
	secrets []*secret
}

// commandEnv is what every settings and provisioning command runs with.
type commandEnv struct {
	cfg     *config.Config
	console console
	stdout  io.Writer
	logger  *slog.Logger
}

// platformDBURL is the connection every settings and provisioning command
// opens: they write the platform_* tables and the tenant rows, which is what
// publira_platform and its BYPASSRLS exist for. Like the job group's chains, it
// ends at PUBLIRA_DB_URL and reads no other role's variable.
func (e *commandEnv) platformDBURL() string {
	return resolveDBURL(e.cfg.DB.URL, "PUBLIRA_PLATFORM_DB_URL")
}

func (e *commandEnv) openPlatformDB() (*sql.DB, error) {
	return sqldb.Open(e.platformDBURL())
}

// errNoEncryptionKeys stops a command that has a secret to store on an install
// whose servers could not decrypt it.
var errNoEncryptionKeys = errors.New("PUBLIRA_SECRET_ENCRYPTION_KEYS is not set; a stored secret is encrypted with the keys the servers decrypt it with")

// secretManager encrypts a secret for storage with the keys config.New()
// resolved, which are the ones the servers read. A command calls it before it
// writes anything, so a missing key stops it with nothing changed.
func (e *commandEnv) secretManager() (*secretcrypto.Manager, error) {
	if len(e.cfg.Encryption.Keys) == 0 {
		return nil, errNoEncryptionKeys
	}
	return secretcrypto.NewManager(e.cfg.Encryption.Keys, e.cfg.Encryption.PrimaryKeyID)
}

// runGroup dispatches one settings or provisioning command. It exits 0 on
// success, 1 on a failure the command reports on stderr, and 2 on a usage
// error, with the usage text on stderr.
func runGroup(g *commandGroup, args []string, con console, stdout io.Writer) int {
	stderr := con.stderr
	if len(args) == 0 {
		return usageError(stderr, g.name+" requires a command", g.usage())
	}
	var c *command
	for i := range g.commands {
		if g.commands[i].name == args[0] {
			c = &g.commands[i]
		}
	}
	if c == nil {
		return usageError(stderr, fmt.Sprintf("unknown %s command %q", g.name, args[0]), g.usage())
	}

	f := &commandFlags{FlagSet: flag.NewFlagSet(g.name+" "+c.name, flag.ContinueOnError)}
	f.SetOutput(io.Discard)
	runCommand := c.setup(f)
	usage := commandUsage(g, c, f)
	if err := f.Parse(args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			_, _ = io.WriteString(stderr, usage)
			return 0
		}
		return usageError(stderr, err.Error(), usage)
	}
	// A positional argument is refused without being repeated: it may be a
	// secret typed where a flag was meant.
	if f.NArg() > 0 {
		return usageError(stderr, fmt.Sprintf("%s %s takes no positional arguments", g.name, c.name), usage)
	}
	if err := f.checkSecretSources(); err != nil {
		return usageError(stderr, err.Error(), usage)
	}

	cfg, err := config.New()
	if err != nil {
		return commandError(stderr, err)
	}
	env := &commandEnv{
		cfg:     cfg,
		console: con,
		stdout:  stdout,
		logger:  logging.New(stderr, &slog.HandlerOptions{Level: slog.LevelInfo}),
	}
	if err := runCommand(context.Background(), env); err != nil {
		return commandError(stderr, err)
	}
	return 0
}

// commandError reports a failure the command ran into and returns its exit
// status.
func commandError(w io.Writer, err error) int {
	_, _ = io.WriteString(w, "publiractl: "+err.Error()+"\n")
	return 1
}

func (g *commandGroup) usage() string {
	var b strings.Builder
	fmt.Fprintf(&b, "\nUsage: publiractl %s <command> [flags]\n\nCommands:\n", g.name)
	for _, c := range g.commands {
		fmt.Fprintf(&b, "  %-25s %s\n", c.name, c.summary)
	}
	return b.String()
}

func commandUsage(g *commandGroup, c *command, f *commandFlags) string {
	var b strings.Builder
	fmt.Fprintf(&b, "\nUsage: publiractl %s %s [flags]\n\n%s\n", g.name, c.name, c.summary)
	hasFlags := false
	f.VisitAll(func(*flag.Flag) { hasFlags = true })
	if hasFlags {
		b.WriteString("\nFlags:\n")
		f.SetOutput(&b)
		f.PrintDefaults()
		f.SetOutput(io.Discard)
	}
	if len(f.secrets) > 0 {
		b.WriteString("\nA secret is read from a masked prompt, or from stdin with its -stdin flag,\none per invocation. It is never taken as an argument.\n")
	}
	return b.String()
}
