package sqldb

import (
	"testing"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
)

func TestServerAttributes(t *testing.T) {
	for _, tc := range []struct {
		name string
		url  string
		want []attribute.KeyValue
	}{
		{
			name: "a URL names its host and port",
			url:  "postgres://publira_public:secret@replica.internal:6432/publira?sslmode=require",
			want: []attribute.KeyValue{semconv.ServerAddress("replica.internal"), semconv.ServerPort(6432)},
		},
		{
			name: "a URL without a port names PostgreSQL's",
			url:  "postgres://publira_public:secret@db.internal/publira",
			want: []attribute.KeyValue{semconv.ServerAddress("db.internal"), semconv.ServerPort(5432)},
		},
		{
			name: "a keyword/value string names its host and port",
			url:  "host=db.internal port=5433 user=publira_public dbname=publira",
			want: []attribute.KeyValue{semconv.ServerAddress("db.internal"), semconv.ServerPort(5433)},
		},
		{
			name: "a URL listing several hosts names the first",
			url:  "postgres://publira_public:secret@first.internal:5432,second.internal:5433/publira",
			want: []attribute.KeyValue{semconv.ServerAddress("first.internal"), semconv.ServerPort(5432)},
		},
		{
			name: "a URL that does not parse names nothing",
			url:  "postgres://publira_public:secret@db.internal:notaport/publira",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := serverAttributes(tc.url)
			if len(got) != len(tc.want) {
				t.Fatalf("serverAttributes = %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("serverAttributes[%d] = %v, want %v", i, got[i], tc.want[i])
				}
			}
		})
	}
}
