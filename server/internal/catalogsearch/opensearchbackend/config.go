package opensearchbackend

import (
	"errors"
	"net/url"
	"os"
	"strings"
)

// DefaultIndex is the index an environment keeps its catalog in when
// PUBLIRA_OPENSEARCH_INDEX names none.
const DefaultIndex = "publira-catalog"

// Config is where the engine is and which index holds the catalog.
type Config struct {
	URL      string
	Username string
	Password string
	Index    string
}

// ConfigFromEnv reads PUBLIRA_OPENSEARCH_URL, PUBLIRA_OPENSEARCH_USERNAME,
// PUBLIRA_OPENSEARCH_PASSWORD, and PUBLIRA_OPENSEARCH_INDEX.
//
// The basic auth credentials come in a pair and only over https://: on an
// http:// URL they would cross the network in cleartext, so the process
// refuses to start rather than send them, the same stance PUBLIRA_REDIS_URL
// takes on a password over redis://.
func ConfigFromEnv() (Config, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_OPENSEARCH_URL"))
	if raw == "" {
		return Config{}, errors.New(`PUBLIRA_OPENSEARCH_URL is required when PUBLIRA_SEARCH_BACKEND is "opensearch"`)
	}
	// The errors name the variable and never print its value, which may carry
	// credentials the URL was refused for.
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return Config{}, errors.New("PUBLIRA_OPENSEARCH_URL is not an http:// or https:// URL")
	}
	if parsed.User != nil {
		return Config{}, errors.New("PUBLIRA_OPENSEARCH_URL carries credentials; set PUBLIRA_OPENSEARCH_USERNAME and PUBLIRA_OPENSEARCH_PASSWORD instead")
	}

	cfg := Config{
		URL:      raw,
		Username: os.Getenv("PUBLIRA_OPENSEARCH_USERNAME"),
		Password: os.Getenv("PUBLIRA_OPENSEARCH_PASSWORD"),
		Index:    strings.TrimSpace(os.Getenv("PUBLIRA_OPENSEARCH_INDEX")),
	}
	if (cfg.Username == "") != (cfg.Password == "") {
		return Config{}, errors.New("PUBLIRA_OPENSEARCH_USERNAME and PUBLIRA_OPENSEARCH_PASSWORD are set together or not at all")
	}
	if cfg.Username != "" && parsed.Scheme != "https" {
		return Config{}, errors.New("PUBLIRA_OPENSEARCH_USERNAME and PUBLIRA_OPENSEARCH_PASSWORD need an https:// PUBLIRA_OPENSEARCH_URL; over http:// they would cross the network in cleartext")
	}
	if cfg.Index == "" {
		cfg.Index = DefaultIndex
	}
	return cfg, nil
}
