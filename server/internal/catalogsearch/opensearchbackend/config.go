package opensearchbackend

// DefaultIndex is the alias a saved configuration keeps its catalog behind when
// it names none.
const DefaultIndex = "publira-catalog"

// Config is where the engine is and which index holds the catalog. Whoever
// builds one has validated it: the URL is http:// or https:// without
// userinfo, and the credentials come in a pair and only over https://.
type Config struct {
	URL      string
	Username string
	Password string
	Index    string
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
