package emailrenderer

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	publiraemailv1 "github.com/publira/publira/server/internal/gen/publira/email/v1"
	publiraemailv1connect "github.com/publira/publira/server/internal/gen/publira/email/v1/publiraemailv1connect"
)

type rendererServiceStub struct {
	publiraemailv1connect.UnimplementedEmailRendererServiceHandler
	request *publiraemailv1.RenderEmailRequest
	err     error
}

func (s *rendererServiceStub) RenderEmail(_ context.Context, req *connect.Request[publiraemailv1.RenderEmailRequest]) (*connect.Response[publiraemailv1.RenderEmailResponse], error) {
	s.request = req.Msg
	if s.err != nil {
		return nil, s.err
	}
	return connect.NewResponse(&publiraemailv1.RenderEmailResponse{
		Subject: "Invitation",
		Html:    "<p>HTML</p>",
		Text:    "Text",
	}), nil
}

func newRendererTestServer(t *testing.T, service *rendererServiceStub) *httptest.Server {
	t.Helper()
	path, handler := publiraemailv1connect.NewEmailRendererServiceHandler(service)
	mux := http.NewServeMux()
	mux.Handle(path, handler)
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
		TimeZone: "Asia/Tokyo",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if email != (Email{Subject: "Invitation", HTML: "<p>HTML</p>", Text: "Text"}) {
		t.Fatalf("email = %+v", email)
	}
	if service.request.GetTemplate() != "tenant_admin_invitation" || service.request.GetLocale() != "ja" || service.request.GetTimeZone() != "Asia/Tokyo" {
		t.Fatalf("request = %+v", service.request)
	}
	if service.request.GetData().GetFields()["tenant_name"].GetStringValue() != "Publira" {
		t.Fatalf("tenant_name = %q, want Publira", service.request.GetData().GetFields()["tenant_name"].GetStringValue())
	}
}

func TestClientRenderPropagatesRendererError(t *testing.T) {
	service := &rendererServiceStub{err: connect.NewError(connect.CodeInvalidArgument, errors.New("invalid template data"))}
	server := newRendererTestServer(t, service)

	_, err := NewClient(server.URL).Render(context.Background(), Request{})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
}
