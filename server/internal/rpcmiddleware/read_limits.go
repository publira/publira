package rpcmiddleware

import (
	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
)

// DefaultReadMaxBytes is the most a procedure reads of one request unless it
// is given a bound of its own. Every namespace is reached before a session is
// checked, and a message is read into memory in full before any interceptor
// runs, so this is what anyone can make the server allocate per request. The
// largest ordinary requests — a page's Markdown, a tenant's list of refused
// addresses, a webhook payload, which the handlers cap at 64 KiB — stay well
// below it.
const DefaultReadMaxBytes = 1 << 20

// ReadLimits are the options that bound what each procedure a connect.Server
// mounts reads of one request: larger names the procedures that legitimately
// receive more, keyed by procedure path, and every other procedure reads at
// most DefaultReadMaxBytes. A request past its procedure's bound is refused
// with resource_exhausted while it is read, before it is decoded.
func ReadLimits(larger map[string]int) []connecthttp.Option {
	return []connecthttp.Option{
		connecthttp.WithReadMaxBytes(DefaultReadMaxBytes),
		connecthttp.WithConditionalOptions(func(spec connect.Spec) []connecthttp.Option {
			if n, ok := larger[spec.Procedure]; ok {
				return []connecthttp.Option{connecthttp.WithReadMaxBytes(n)}
			}
			return nil
		}),
	}
}
