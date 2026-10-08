package testutil

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// ReadLimitCode posts size bytes to procedure on handler as a unary Connect
// request in the binary Protobuf encoding and answers with the code the
// request was refused with. The bytes are not a message, so a request the
// read limit lets through is refused as invalid_argument when it is decoded,
// and one past the limit as resource_exhausted before that; no handler runs
// either way. The body is generated as it is sent, so a test of a large limit
// holds none of it.
func ReadLimitCode(t *testing.T, handler http.Handler, procedure string, size int64) connect.Code {
	t.Helper()
	return post(t, handler, procedure, "application/proto", io.LimitReader(filler{}, size), size)
}

// RequestCode posts msg to procedure on handler as a unary Connect request in
// the binary Protobuf encoding, the way ReadLimitCode posts its bytes, and
// answers with the code the request was refused with, or 0 when it succeeded.
func RequestCode(t *testing.T, handler http.Handler, procedure string, msg proto.Message) connect.Code {
	t.Helper()
	body, err := proto.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal %T: %v", msg, err)
	}
	return post(t, handler, procedure, "application/proto", bytes.NewReader(body), int64(len(body)))
}

// JSONRequestCode is RequestCode in the JSON encoding, which carries a bytes
// field in base64 and so makes the same message a third larger.
func JSONRequestCode(t *testing.T, handler http.Handler, procedure string, msg proto.Message) connect.Code {
	t.Helper()
	body, err := protojson.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal %T: %v", msg, err)
	}
	return post(t, handler, procedure, "application/json", bytes.NewReader(body), int64(len(body)))
}

func post(t *testing.T, handler http.Handler, procedure, contentType string, body io.Reader, size int64) connect.Code {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, procedure, body)
	req.ContentLength = size
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		return 0
	}

	var answer struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatalf("%s answered %d with %q, which is not a Connect error", procedure, rec.Code, rec.Body.String())
	}
	var code connect.Code
	if err := code.UnmarshalText([]byte(answer.Code)); err != nil {
		t.Fatalf("%s answered with code %q: %v", procedure, answer.Code, err)
	}
	return code
}

// filler reads as an endless run of 0xff, which never decodes as a Protobuf
// message: the first field tag it starts is a varint that does not end.
type filler struct{}

func (filler) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0xff
	}
	return len(p), nil
}
