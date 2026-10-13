// Command publira runs a Publira deployment's two long-lived processes. The
// first argument names which one:
//
//   - server answers the edge and the Next.js apps: all three Connect
//     namespaces under /api and image delivery under /images, on the one
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
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
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
		if len(rest) > 0 {
			return usageError(stderr, fmt.Sprintf("%s takes no arguments", command))
		}
		return serve(command, hosted{worker: true})
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
	fs.BoolVar(&withWorker, "with-worker", false, "")
	if err := fs.Parse(args); err != nil {
		return hosted{}, err
	}
	if fs.NArg() > 0 {
		return hosted{}, errors.New("server takes no arguments other than --with-worker")
	}
	return hosted{server: true, worker: withWorker}, nil
}

// usageError reports a bad invocation on w, followed by the usage text, and
// returns the exit status for it.
func usageError(w io.Writer, reason string) int {
	_, _ = io.WriteString(w, "publira: "+reason+"\n"+usage())
	return 2
}

func usage() string {
	return "\nUsage: publira <command> [flags]\n\nCommands:\n" +
		"  server         Serve the API and image delivery to the edge and the Next.js apps\n" +
		"  worker         Drain the Outbox and run every scheduled job\n" +
		"\nFlags of server:\n" +
		"  --with-worker  Host the worker in the same process as well\n" +
		"\nEvery command reads its settings from the environment.\n"
}
