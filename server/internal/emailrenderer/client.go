// Package emailrenderer provides the Go client for the email-renderer service.
package emailrenderer

import (
	"context"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/structpb"

	publiraemailv1 "github.com/publira/publira/server/internal/gen/publira/email/v1"
	publiraemailv1connect "github.com/publira/publira/server/internal/gen/publira/email/v1/publiraemailv1connect"
	"github.com/publira/publira/server/internal/tracing"
)

const DefaultURL = "http://localhost:8080"

// Renderer turns a template and its data into an SMTP-ready email body.
type Renderer interface {
	Render(context.Context, Request) (Email, error)
}

type Request struct {
	Template string
	Locale   string
	Data     map[string]any
	TimeZone string
}

type Email struct {
	Subject string
	HTML    string
	Text    string
}

type Client struct {
	client publiraemailv1connect.EmailRendererServiceClient
}

func NewClient(baseURL string) *Client {
	return NewClientWithHTTPClient(&http.Client{
		Timeout: 10 * time.Second,
		// Carries the trace context of the request that needed the email
		// into the renderer service.
		Transport: tracing.Transport(http.DefaultTransport),
	}, baseURL)
}

func NewClientWithHTTPClient(httpClient connect.HTTPClient, baseURL string) *Client {
	return &Client{
		client: publiraemailv1connect.NewEmailRendererServiceClient(
			httpClient,
			strings.TrimRight(baseURL, "/"),
		),
	}
}

func (c *Client) Render(ctx context.Context, input Request) (Email, error) {
	data, err := structpb.NewStruct(input.Data)
	if err != nil {
		return Email{}, err
	}

	response, err := c.client.RenderEmail(ctx, connect.NewRequest(&publiraemailv1.RenderEmailRequest{
		Template: input.Template,
		Locale:   input.Locale,
		Data:     data,
		TimeZone: input.TimeZone,
	}))
	if err != nil {
		return Email{}, err
	}

	return Email{
		Subject: response.Msg.GetSubject(),
		HTML:    response.Msg.GetHtml(),
		Text:    response.Msg.GetText(),
	}, nil
}
