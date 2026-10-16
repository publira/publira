package opensearchbackend

import "strings"

// DefaultIndex is the alias a saved configuration keeps its catalog behind when
// it names none.
const DefaultIndex = "publira-catalog"

// Config is where the engine is, which index holds the catalog, and the
// analysis an index the backend creates is built with. Whoever builds one has
// validated it: the URL is http:// or https:// without userinfo, the
// credentials come in a pair and only over https://, and Analysis is empty or
// what [ParseAnalysis] answered.
type Config struct {
	URL      string
	Username string
	Password string
	Index    string
	// Analysis is the settings.analysis of an index the backend creates, as
	// JSON. Empty is [DefaultAnalysis]. A search never depends on it: the
	// index it searches was created with whatever it was created with. Every
	// language's index is created with the same one.
	Analysis string
	// Locales are the languages the catalog keeps an index for, each behind
	// the alias [LocaleAlias] names after Index, holding the series in that
	// language. Empty is the one index an install built before the catalog was
	// indexed per language, behind Index itself, whose series are in their
	// tenant's default language whatever the reader's.
	Locales []string
}

// LocaleAlias is the alias of the catalog index of one language, named after
// the alias the platform saved. An index name has no capital letters, so the
// language is lowercased: zh-Hans is behind publira-catalog-zh-hans.
func LocaleAlias(index, locale string) string {
	return index + "-" + strings.ToLower(locale)
}

// String leaves the password out, so a Config that reaches a log line or an
// error does not carry it.
func (c Config) String() string {
	return "{URL:" + c.URL + " Index:" + c.Index + " Username:" + c.Username + "}"
}

// GoString is String for %#v.
func (c Config) GoString() string {
	return c.String()
}
