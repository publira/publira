// Command publiractl operates a Publira install from a command line. It
// connects to PostgreSQL directly rather than through ConnectRPC, so it works
// on a deployment that serves no platform API.
//
// Every word is looked up in one tree of command groups, rootGroup, which also
// gives each level its usage text and every command its exit status. The first
// argument names a group, or setup. db applies db/migrations to the database
// PUBLIRA_DB_URL names, creates the login roles every process connects as, and
// reports its schema version. job runs one of the worker's maintenance jobs by
// hand: the second argument names the job, which is configured through
// environment variables, rebuilds, purges, or closes a period of data once, and
// exits. The worker schedules the same jobs, so nothing needs to schedule this
// command.
//
// The settings and provisioning groups change what the Platform Console
// changes. They connect as PUBLIRA_PLATFORM_DB_URL, take a secret only from a
// masked prompt, stdin, or a file, and file their audit entries under
// auditlog.SystemPlatformActor. setup runs them in order, asking for what an
// install needs to serve its first tenant.
//
// Each job is a thin invocation of internal/maintenance, which the worker's
// River jobs invoke as well, so an operator's explicit run and a scheduled one
// are the same implementation.
//
// The jobs that have to act the moment a stored instant passes are not here:
// they run as River periodic jobs inside the worker (internal/tickerjobs).
package main

import (
	"errors"
	"io"
	"os"
	"strconv"
	"strings"
	"time"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stderr))
}

func run(args []string, stderr io.Writer) int {
	con := osConsole()
	con.stderr = stderr
	return runGroup(&rootGroup, args, con, os.Stdout)
}

// usageError reports a bad invocation on w, followed by the usage text for the
// level it happened at, and returns the exit status for it.
func usageError(w io.Writer, reason, usage string) int {
	_, _ = io.WriteString(w, "publiractl: "+reason+"\n"+usage)
	return 2
}

// resolveDBURL returns the first non-empty environment variable in names, so a
// job can be pointed at the role it needs without disturbing the other
// processes, and falls back to the shared connection string when none is set.
//
// PUBLIRA_WORKER_DB_URL belongs to no chain here. The jobs once shared it
// with the worker because both ran on the same connection, but it now names
// publira_outbox, a role that owns River's schema and that the daily jobs
// must not be able to alter. A job left unconfigured falls through to
// PUBLIRA_DB_URL, which is where it ran before the dedicated stats role existed.
func resolveDBURL(fallback string, names ...string) string {
	for _, name := range names {
		if url := strings.TrimSpace(os.Getenv(name)); url != "" {
			return url
		}
	}
	return fallback
}

// resolveTenantLocalDate reads the calendar date a daily job covers from the
// named variable. The date is each tenant's own local one, so an unset variable
// cannot be answered here with a single day: it yields the zero time, and the
// job resolves every tenant's yesterday in that tenant's zone.
func resolveTenantLocalDate(name string) (time.Time, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.DateOnly, raw)
}

// resolveDryRun reads the switch that turns one purge into a report of what it
// would delete. It is a control over a single invocation rather than a setting
// of the deployment, which is why it is read here and not alongside the
// tunables every caller of internal/maintenance shares.
func resolveDryRun(name string) (bool, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return false, nil
	}
	dryRun, err := strconv.ParseBool(raw)
	if err != nil {
		return false, errors.New("dry-run must be a boolean such as true or false")
	}
	return dryRun, nil
}
