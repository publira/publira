package rpcmiddleware_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectinprocess"
	"google.golang.org/protobuf/proto"

	publiraemailv1 "github.com/publira/publira/server/internal/proto/gen/publira/email/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/email/v1/publiraemailv1connect"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

type contextKey struct{}

// renderer answers RenderEmail through serve, so a test sees what the handler
// was given.
type renderer struct {
	publiraemailv1connect.UnimplementedEmailRendererServiceHandler
	serve func(context.Context, *publiraemailv1.RenderEmailRequest) (*publiraemailv1.RenderEmailResponse, error)
}

func (r renderer) RenderEmail(ctx context.Context, req *publiraemailv1.RenderEmailRequest) (*publiraemailv1.RenderEmailResponse, error) {
	return r.serve(ctx, req)
}

func newRendererClient(interceptor connect.ServerInterceptor, handler renderer) publiraemailv1connect.EmailRendererServiceClient {
	server := connect.NewServer(interceptor)
	publiraemailv1connect.RegisterEmailRendererServiceHandler(server, handler)
	return publiraemailv1connect.NewEmailRendererServiceClient(connect.NewClient(connectinprocess.New(server)))
}

func TestNewUnaryContextBuilderInterceptor_InjectsContext(t *testing.T) {
	want := "injected-value"
	var builtFrom string
	builder := rpcmiddleware.UnaryContextBuilder(func(ctx context.Context, _ connect.Spec, req proto.Message) (context.Context, error) {
		builtFrom = req.(*publiraemailv1.RenderEmailRequest).GetTemplate()
		return context.WithValue(ctx, contextKey{}, want), nil
	})

	client := newRendererClient(rpcmiddleware.NewUnaryContextBuilderInterceptor(builder), renderer{
		serve: func(ctx context.Context, req *publiraemailv1.RenderEmailRequest) (*publiraemailv1.RenderEmailResponse, error) {
			got, ok := ctx.Value(contextKey{}).(string)
			if !ok {
				t.Error("context value not found")
			}
			if got != want {
				t.Errorf("context value = %q, want %q", got, want)
			}
			if req.GetTemplate() != "welcome" {
				t.Errorf("handler template = %q, want the message the builder read", req.GetTemplate())
			}
			return &publiraemailv1.RenderEmailResponse{}, nil
		},
	})

	if _, err := client.RenderEmail(t.Context(), &publiraemailv1.RenderEmailRequest{Template: "welcome"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if builtFrom != "welcome" {
		t.Errorf("builder template = %q, want welcome", builtFrom)
	}
}

func TestNewUnaryContextBuilderInterceptor_BuilderErrorStopsChain(t *testing.T) {
	buildErr := connect.NewError(connect.CodePermissionDenied, "build failed")
	builder := rpcmiddleware.UnaryContextBuilder(func(context.Context, connect.Spec, proto.Message) (context.Context, error) {
		return nil, buildErr
	})

	handlerCalled := false
	client := newRendererClient(rpcmiddleware.NewUnaryContextBuilderInterceptor(builder), renderer{
		serve: func(context.Context, *publiraemailv1.RenderEmailRequest) (*publiraemailv1.RenderEmailResponse, error) {
			handlerCalled = true
			return &publiraemailv1.RenderEmailResponse{}, nil
		},
	})

	_, err := client.RenderEmail(t.Context(), &publiraemailv1.RenderEmailRequest{})
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("error = %v, want the builder's permission_denied", err)
	}
	if handlerCalled {
		t.Error("handler should not be called when builder returns an error")
	}
}

// A change the interceptor makes to the request message is what the handler
// receives, which is how the session builder fills in a tenant named only by
// header.
func TestNewUnaryRequestInterceptor_HandsTheHandlerTheMessageItRead(t *testing.T) {
	interceptor := rpcmiddleware.NewUnaryRequestInterceptor(func(ctx context.Context, _ connect.Spec, req proto.Message, next func(context.Context) error) error {
		req.(*publiraemailv1.RenderEmailRequest).Locale = "ja"
		return next(ctx)
	})

	client := newRendererClient(interceptor, renderer{
		serve: func(_ context.Context, req *publiraemailv1.RenderEmailRequest) (*publiraemailv1.RenderEmailResponse, error) {
			if req.GetLocale() != "ja" {
				return nil, errors.New("locale was not carried over")
			}
			return &publiraemailv1.RenderEmailResponse{Html: req.GetTemplate()}, nil
		},
	})

	res, err := client.RenderEmail(t.Context(), &publiraemailv1.RenderEmailRequest{Template: "welcome"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.GetHtml() != "welcome" {
		t.Errorf("html = %q, want the template echoed back", res.GetHtml())
	}
}
