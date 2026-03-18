package rpcmiddleware_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/publira/publira/server/internal/rpcmiddleware"
)

type contextKey struct{}

func TestNewUnaryContextBuilderInterceptor_InjectsContext(t *testing.T) {
	want := "injected-value"
	builder := rpcmiddleware.UnaryContextBuilder(func(ctx context.Context, _ connect.AnyRequest) (context.Context, error) {
		return context.WithValue(ctx, contextKey{}, want), nil
	})

	interceptor := rpcmiddleware.NewUnaryContextBuilderInterceptor(builder)
	wrapped := interceptor.WrapUnary(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		got, ok := ctx.Value(contextKey{}).(string)
		if !ok {
			t.Error("context value not found")
		}
		if got != want {
			t.Errorf("context value = %q, want %q", got, want)
		}
		return connect.NewResponse(&emptypb.Empty{}), nil
	})

	req := connect.NewRequest(&emptypb.Empty{})
	if _, err := wrapped(context.Background(), req); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNewUnaryContextBuilderInterceptor_BuilderErrorStopsChain(t *testing.T) {
	buildErr := errors.New("build failed")
	builder := rpcmiddleware.UnaryContextBuilder(func(_ context.Context, _ connect.AnyRequest) (context.Context, error) {
		return nil, buildErr
	})

	interceptor := rpcmiddleware.NewUnaryContextBuilderInterceptor(builder)
	handlerCalled := false
	wrapped := interceptor.WrapUnary(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		handlerCalled = true
		return connect.NewResponse(&emptypb.Empty{}), nil
	})

	req := connect.NewRequest(&emptypb.Empty{})
	_, err := wrapped(context.Background(), req)
	if !errors.Is(err, buildErr) {
		t.Errorf("error = %v, want %v", err, buildErr)
	}
	if handlerCalled {
		t.Error("handler should not be called when builder returns an error")
	}
}
