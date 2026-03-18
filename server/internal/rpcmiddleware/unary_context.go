package rpcmiddleware

import (
	"context"

	"connectrpc.com/connect"
)

// UnaryContextBuilder builds a derived context from each unary request.
type UnaryContextBuilder func(ctx context.Context, req connect.AnyRequest) (context.Context, error)

// NewUnaryContextBuilderInterceptor applies context building logic to any unary endpoint.
func NewUnaryContextBuilderInterceptor(builder UnaryContextBuilder) connect.Interceptor {
	return connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			nextCtx, err := builder(ctx, req)
			if err != nil {
				return nil, err
			}
			return next(nextCtx, req)
		}
	})
}
