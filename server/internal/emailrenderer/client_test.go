package emailrenderer

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	publiraemailv1 "github.com/publira/publira/server/internal/proto/gen/publira/email/v1"
	publiraemailv1connect "github.com/publira/publira/server/internal/proto/gen/publira/email/v1/publiraemailv1connect"
)

type rendererServiceStub struct {
	publiraemailv1connect.UnimplementedEmailRendererServiceHandler
	request *publiraemailv1.RenderEmailRequest
	err     error
}

func (s *rendererServiceStub) RenderEmail(_ context.Context, req *publiraemailv1.RenderEmailRequest) (*publiraemailv1.RenderEmailResponse, error) {
	s.request = req
	if s.err != nil {
		return nil, s.err
	}
	return &publiraemailv1.RenderEmailResponse{Html: "<p>HTML</p>"}, nil
}

func newRendererTestServer(t *testing.T, service *rendererServiceStub) *httptest.Server {
	t.Helper()
	rpc := connect.NewServer()
	publiraemailv1connect.RegisterEmailRendererServiceHandler(rpc, service)
	mux := http.NewServeMux()
	connecthttp.Mount(mux, rpc)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func TestClientRender(t *testing.T) {
	service := &rendererServiceStub{}
	server := newRendererTestServer(t, service)
	client := NewClient(server.URL + "/")

	email, err := client.Render(context.Background(), Request{
		Template: "tenant_admin_invitation",
		Locale:   "ja",
		Data: map[string]any{
			"invite_url":  "https://admin.example.com/accept-invite?token=token",
			"tenant_name": "Publira",
		},
		TimeZone: "UTC",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if email != (Email{HTML: "<p>HTML</p>"}) {
		t.Fatalf("email = %+v", email)
	}
	if service.request.GetTemplate() != "tenant_admin_invitation" || service.request.GetLocale() != "ja" || service.request.GetTimeZone() != "UTC" {
		t.Fatalf("request = %+v", service.request)
	}
	if service.request.GetData().GetFields()["tenant_name"].GetStringValue() != "Publira" {
		t.Fatalf("tenant_name = %q, want Publira", service.request.GetData().GetFields()["tenant_name"].GetStringValue())
	}
}

func TestClientRenderPropagatesRendererError(t *testing.T) {
	service := &rendererServiceStub{err: connect.NewError(connect.CodeInvalidArgument, "invalid template data")}
	server := newRendererTestServer(t, service)

	_, err := NewClient(server.URL).Render(context.Background(), Request{})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
}
