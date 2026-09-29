// Package buildinfo reports the version of the running binary.
//
// Telemetry needs a version to attribute a regression to a deploy, and the
// value has to survive the container build, where the source is copied
// without a .git directory and Go cannot stamp VCS information itself.
package buildinfo

import (
	"runtime/debug"
	"strings"
)

// DevVersion is reported when the binary carries no version at all: a local
// `go run` or `go build` outside a checkout.
const DevVersion = "dev"

// version is stamped at link time by the container builds:
//
//	go build -ldflags "-X github.com/publira/publira/server/internal/buildinfo.version=$VERSION"
var version string

// vcsRevisionLength keeps the fallback revision short enough to read in a
// trace UI while staying unambiguous.
const vcsRevisionLength = 12

// Version returns, in order of preference, the version stamped at link
// time, the VCS revision Go recorded when the binary was built inside a
// checkout, the module version, or [DevVersion].
func Version() string {
	if v := strings.TrimSpace(version); v != "" {
		return v
	}

	info, ok := debug.ReadBuildInfo()
	if !ok {
		return DevVersion
	}

	for _, setting := range info.Settings {
		if setting.Key != "vcs.revision" {
			continue
		}
		if revision := strings.TrimSpace(setting.Value); revision != "" {
			if len(revision) > vcsRevisionLength {
				revision = revision[:vcsRevisionLength]
			}
			return revision
		}
	}

	// "(devel)" is what the toolchain reports for a main module built
	// outside a tagged release, which says no more than DevVersion does.
	if v := strings.TrimSpace(info.Main.Version); v != "" && v != "(devel)" {
		return v
	}

	return DevVersion
}
