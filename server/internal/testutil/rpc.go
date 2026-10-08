package testutil

import (
	"context"
	"slices"

	"connectrpc.com/connect/v2"
)

// NewClientContext is connect.NewClientContext for a ctx that may already
// carry request headers from WithRequestHeader: the CallInfo it returns starts
// with those headers, and reads the response headers of the RPC made with the
// returned context.
func NewClientContext(ctx context.Context) (context.Context, *connect.CallInfo) {
	parent, hasParent := connect.CallInfoForClientContext(ctx)
	ctx, info := connect.NewClientContext(ctx)
	if hasParent {
		for name, values := range parent.RequestHeader().All() {
			info.RequestHeader().SetValues(name, slices.Clone(values))
		}
	}
	return ctx, info
}

// WithRequestHeader returns ctx with key set to value among the request
// headers of the RPCs a client makes with it, on top of any ctx already
// carries. ctx itself is left as it was, so one context can fork into
// requests that differ in a header.
func WithRequestHeader(ctx context.Context, key, value string) context.Context {
	ctx, info := NewClientContext(ctx)
	info.RequestHeader().Set(key, value)
	return ctx
}

// WithBearer is WithRequestHeader for an Authorization: Bearer token.
func WithBearer(ctx context.Context, token string) context.Context {
	return WithRequestHeader(ctx, "Authorization", "Bearer "+token)
}

// NewServerContext returns ctx as a handler serving an RPC sees it, along
// with the CallInfo that handler reads its request headers from and writes
// its response headers to. It is for a test that calls a handler method
// directly rather than through a client.
func NewServerContext(ctx context.Context) (context.Context, *connect.CallInfo) {
	info := &connect.CallInfo{}
	server := connect.NewServer()
	served := ctx
	server.SetUnknownHandler(func(ctx context.Context, _ connect.Spec, _ connect.ServerStream) error {
		served = ctx
		return nil
	})
	_ = server.Call(ctx, "/", info, nil)
	return served, info
}
