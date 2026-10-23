package sqldb

import (
	"strings"
	"testing"
	"time"
)

func TestLimitsFromEnvDefaultsToABoundedPoolThatKeepsItsConnections(t *testing.T) {
	t.Setenv(maxOpenConnsEnv, "")
	t.Setenv(maxIdleConnsEnv, "")
	t.Setenv(connMaxIdleTimeEnv, "")

	got, err := limitsFromEnv()
	if err != nil {
		t.Fatalf("limitsFromEnv: %v", err)
	}
	want := poolLimits{
		MaxOpenConns:    defaultMaxOpenConns,
		MaxIdleConns:    defaultMaxOpenConns,
		ConnMaxIdleTime: defaultConnMaxIdleTime,
	}
	if got != want {
		t.Fatalf("limitsFromEnv() = %+v, want %+v", got, want)
	}
}

func TestLimitsFromEnvReadsEachVariable(t *testing.T) {
	for _, tc := range []struct {
		name                  string
		maxOpen, maxIdle, ttl string
		want                  poolLimits
	}{
		{
			name:    "a larger pool keeps every connection it may open",
			maxOpen: "25",
			want:    poolLimits{MaxOpenConns: 25, MaxIdleConns: 25, ConnMaxIdleTime: defaultConnMaxIdleTime},
		},
		{
			name:    "fewer idle connections than open ones",
			maxOpen: "20",
			maxIdle: "4",
			want:    poolLimits{MaxOpenConns: 20, MaxIdleConns: 4, ConnMaxIdleTime: defaultConnMaxIdleTime},
		},
		{
			name:    "no idle connections at all",
			maxIdle: "0",
			want:    poolLimits{MaxOpenConns: defaultMaxOpenConns, MaxIdleConns: 0, ConnMaxIdleTime: defaultConnMaxIdleTime},
		},
		{
			name: "an idle time as a Go duration",
			ttl:  "90s",
			want: poolLimits{MaxOpenConns: defaultMaxOpenConns, MaxIdleConns: defaultMaxOpenConns, ConnMaxIdleTime: 90 * time.Second},
		},
		{
			name: "zero keeps idle connections open",
			ttl:  "0",
			want: poolLimits{MaxOpenConns: defaultMaxOpenConns, MaxIdleConns: defaultMaxOpenConns, ConnMaxIdleTime: 0},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(maxOpenConnsEnv, tc.maxOpen)
			t.Setenv(maxIdleConnsEnv, tc.maxIdle)
			t.Setenv(connMaxIdleTimeEnv, tc.ttl)

			got, err := limitsFromEnv()
			if err != nil {
				t.Fatalf("limitsFromEnv: %v", err)
			}
			if got != tc.want {
				t.Fatalf("limitsFromEnv() = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestLimitsFromEnvRefusesAnInvalidValue(t *testing.T) {
	for _, tc := range []struct {
		name                  string
		maxOpen, maxIdle, ttl string
	}{
		{name: "max open not a number", maxOpen: "ten"},
		{name: "max open zero, which database/sql reads as unbounded", maxOpen: "0"},
		{name: "max open of one, which a request waiting for a second connection deadlocks", maxOpen: "1"},
		{name: "max open of two, which a maintenance pass and a search index build each holding a lock deadlock", maxOpen: "2"},
		{name: "max idle negative", maxIdle: "-1"},
		{name: "max idle above max open", maxOpen: "5", maxIdle: "6"},
		{name: "idle time without a unit", ttl: "300"},
		{name: "idle time negative", ttl: "-1m"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(maxOpenConnsEnv, tc.maxOpen)
			t.Setenv(maxIdleConnsEnv, tc.maxIdle)
			t.Setenv(connMaxIdleTimeEnv, tc.ttl)

			if got, err := limitsFromEnv(); err == nil {
				t.Fatalf("limitsFromEnv() = %+v, want an error", got)
			}
		})
	}
}

// An invalid bound stops Open before it connects, so the process fails at
// startup with the variable's name instead of running on a pool nobody sized.
func TestOpenRefusesAnInvalidBoundBeforeConnecting(t *testing.T) {
	t.Setenv(maxOpenConnsEnv, "1")

	db, err := Open("postgres://nobody@127.0.0.1:1/none?sslmode=disable&connect_timeout=1")
	if err == nil {
		_ = db.Close()
		t.Fatal("Open succeeded with an invalid bound")
	}
	if !strings.Contains(err.Error(), maxOpenConnsEnv) {
		t.Fatalf("Open error = %q, want it to name %s", err, maxOpenConnsEnv)
	}
}
