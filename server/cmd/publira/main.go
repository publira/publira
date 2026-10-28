// Command publira runs a Publira deployment's two long-lived processes. The
// first argument names which one:
//
//   - server answers the edge and the Next.js apps: all three Connect
//     namespaces under /rpc and image delivery under /images, on the one
//     listener the reverse proxy forwards to and the apps dial.
//   - worker drains the Outbox and hosts every River-backed job.
//
// One binary rather than one per process keeps a deployment to the two
// processes above beside the Next.js apps, with one image to build and one
// set of environment variables to document. publiractl, the command an
// operator runs by hand, stays a binary of its own because it has to work on
// a deployment that serves nothing.
//
// server --with-worker hosts the worker in the server's process as well, for
// an install that will not scale the two apart. It is a flag on server rather
// than a third command because the server is the process the reverse proxy
// points at, and the worker riding in it is an extension of that process.
//
// server --role storefront, admin, or platform, in any combination, serves
// those API surfaces alone, each with its namespace, its share of image
// delivery, and its database login, for an install that keeps the process the
// edge forwards to from holding the consoles' logins.
//
// worker --queue outbox, ticker, maintenance, or search_index, in any
// combination, hosts those River queues alone, each with the database login
// its jobs connect as, for an install that keeps the Outbox drain apart from
// the hour-long maintenance passes. server --with-worker takes the same flag.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stderr))
}

// run resolves the command. A command that starts serving never returns
// here on success: it blocks until a signal stops it and reports its own
// failures, so the exit status it answers with is the whole of the contract.
func run(args []string, stderr io.Writer) int {
	if len(args) == 0 {
		return usageError(stderr, "a command is required")
	}
	command, rest := args[0], args[1:]
	switch command {
	case "server":
		h, err := parseServerFlags(rest)
		if err != nil {
			return usageError(stderr, err.Error())
		}
		return serve(command, h)
	case "worker":
		queues, err := parseWorkerFlags(rest)
		if err != nil {
			return usageError(stderr, err.Error())
		}
		return serve(command, hosted{worker: queues})
	default:
		return usageError(stderr, fmt.Sprintf("unknown command %q", command))
	}
}

// parseServerFlags reads the flags server takes. A flag chooses what the
// process hosts and nothing else: every value it runs with comes from the
// environment, so anything else after the command is a mistake rather than a
// setting.
func parseServerFlags(args []string) (hosted, error) {
	fs := flag.NewFlagSet("server", flag.ContinueOnError)
	// The flag package prints its own usage on a parse error; run prints this
	// command's instead.
	fs.SetOutput(io.Discard)
	var withWorker bool
	var roles serverRoles
	named := false
	fs.BoolVar(&withWorker, "with-worker", false, "")
	fs.Func("role", "", func(value string) error {
		named = true
		return roles.add(value)
	})
	var queues queueFlag
	queues.define(fs)
	if err := fs.Parse(args); err != nil {
		return hosted{}, err
	}
	if fs.NArg() > 0 {
		return hosted{}, errors.New("server takes no arguments other than --role, --with-worker, and --queue")
	}
	if !named {
		roles = allServerRoles
	}
	h := hosted{server: roles}
	switch {
	case withWorker:
		h.worker = queues.value()
	case queues.named:
		return hosted{}, errors.New("--queue names the queues of the worker --with-worker hosts, and is not given without it")
	}
	return h, nil
}

// parseWorkerFlags reads the flags worker takes, on the same terms as
// parseServerFlags.
func parseWorkerFlags(args []string) (workerQueues, error) {
	fs := flag.NewFlagSet("worker", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var queues queueFlag
	queues.define(fs)
	if err := fs.Parse(args); err != nil {
		return workerQueues{}, err
	}
	if fs.NArg() > 0 {
		return workerQueues{}, errors.New("worker takes no arguments other than --queue")
	}
	return queues.value(), nil
}

// queueFlag is --queue, which worker and server --with-worker both take.
type queueFlag struct {
	queues workerQueues
	named  bool
}

func (f *queueFlag) define(fs *flag.FlagSet) {
	fs.Func("queue", "", func(value string) error {
		f.named = true
		return f.queues.add(value)
	})
}

// value is what the flag named once parsed: every queue when it was not
// given.
func (f *queueFlag) value() workerQueues {
	if !f.named {
		return allWorkerQueues
	}
	return f.queues
}

// add takes one --role value, a comma-separated list of roles. A list that
// names nothing, an unknown role, or a role already named is a mistake rather
// than a setting, so it is refused instead of narrowed to what it could mean.
func (r *serverRoles) add(value string) error {
	for name := range strings.SplitSeq(value, ",") {
		var role *bool
		switch strings.TrimSpace(name) {
		case "storefront":
			role = &r.storefront
		case "admin":
			role = &r.admin
		case "platform":
			role = &r.platform
		case "":
			return errors.New("--role names an empty role; name storefront, admin, or platform")
		default:
			return fmt.Errorf("--role must be storefront, admin, or platform, not %q", name)
		}
		if *role {
			return fmt.Errorf("--role names %q twice", strings.TrimSpace(name))
		}
		*role = true
	}
	return nil
}

// usageError reports a bad invocation on w, followed by the usage text, and
// returns the exit status for it.
func usageError(w io.Writer, reason string) int {
	_, _ = io.WriteString(w, "publira: "+reason+"\n"+usage())
	return 2
}

func usage() string {
	return "\nUsage: publira <command> [flags]\n\nCommands:\n" +
		"  server                  Serve the API and image delivery to the edge and the Next.js apps\n" +
		"  worker                  Drain the Outbox and run every scheduled job\n" +
		"\nFlags of server:\n" +
		"  --role <role>[,...]     Serve storefront, admin, or platform alone instead of all three\n" +
		"  --with-worker           Host the worker in the same process as well\n" +
		"  --queue <queue>[,...]   Host the named worker queues alone, as worker does; needs --with-worker\n" +
		"\nFlags of worker:\n" +
		"  --queue <queue>[,...]   Host outbox, ticker, maintenance, or search_index alone instead of all four\n" +
		"\nEvery command reads its settings from the environment.\n"
}
