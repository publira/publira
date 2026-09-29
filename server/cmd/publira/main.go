// Command publira runs a Publira deployment's two long-lived processes. The
// first argument names which one:
//
//   - server answers the edge and the Next.js apps: the public API and image
//     delivery on the listener the reverse proxy forwards /api and /images to,
//     and all three Connect namespaces on the internal listener the apps dial.
//   - worker drains the Outbox and hosts every River-backed job.
//
// One binary rather than one per process keeps a deployment to the two
// processes above beside the Next.js apps, with one image to build and one
// set of environment variables to document. publiractl, the command an
// operator runs by hand, stays a binary of its own because it has to work on
// a deployment that serves nothing.
package main

import (
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
	if len(args) > 1 {
		return usageError(stderr, fmt.Sprintf("%s takes no arguments", args[0]))
	}
	switch args[0] {
	case "server":
		return runServer()
	case "worker":
		return runWorker()
	default:
		return usageError(stderr, fmt.Sprintf("unknown command %q", args[0]))
	}
}

// usageError reports a bad invocation on w, followed by the usage text, and
// returns the exit status for it.
func usageError(w io.Writer, reason string) int {
	_, _ = io.WriteString(w, "publira: "+reason+"\n"+usage())
	return 2
}

func usage() string {
	return "\nUsage: publira <command>\n\nCommands:\n" +
		"  server                    Serve the API and image delivery to the edge and the Next.js apps\n" +
		"  worker                    Drain the Outbox and run every scheduled job\n" +
		"\nEvery command reads its settings from the environment.\n"
}
