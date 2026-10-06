package inboundprovider

import (
	"regexp"
	"strings"
)

var (
	// originalMessagePattern is the separator Outlook and mailers modelled on
	// it put above the mail they answer, which they do not prefix with ">".
	originalMessagePattern = regexp.MustCompile(`(?i)^-{2,}\s*(original message|forwarded message)\s*-{2,}$`)
	// underscoreRulePattern is the rule Outlook on the web draws instead,
	// followed by the answered mail's From line.
	underscoreRulePattern = regexp.MustCompile(`^_{10,}$`)
	// headerLinePattern is the From line a quoted header block starts with,
	// in the languages the storefront ships.
	headerLinePattern = regexp.MustCompile(`(?i)^(from|差出人|送信者|보낸 사람|发件人|寄件者)\s*[:：]`)
	// wrotePattern is how an attribution that names no address ends, as
	// Thunderbird's "On 10/5/26 18:30, Example wrote:" does.
	wrotePattern = regexp.MustCompile(`(?i)(wrote|schrieb|a écrit|escribió|написал|写道|작성)\s*[:：]$`)
)

// StripQuoted answers text without the mail it replies to: the quotation a
// mail client appends below a reply, the attribution line it writes above
// that quotation ("On … wrote:"), and an Outlook-style original message
// block. A quotation the reader interleaved with their own lines is kept, as
// it is part of what they wrote. The result is trimmed.
func StripQuoted(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")

	cut := len(lines)
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if originalMessagePattern.MatchString(trimmed) {
			cut = i
			break
		}
		if underscoreRulePattern.MatchString(trimmed) && headerLinePattern.MatchString(nextNonBlank(lines, i+1)) {
			cut = i
			break
		}
		if isQuoted(line) && quotedToEnd(lines, i) {
			cut = withoutAttribution(lines, i)
			break
		}
	}
	return strings.TrimSpace(strings.Join(lines[:cut], "\n"))
}

func isQuoted(line string) bool {
	return strings.HasPrefix(strings.TrimLeft(line, " \t"), ">")
}

// quotedToEnd reports whether every line from start on is quoted or blank, so
// that nothing the reader wrote follows the quotation.
func quotedToEnd(lines []string, start int) bool {
	for _, line := range lines[start:] {
		if strings.TrimSpace(line) != "" && !isQuoted(line) {
			return false
		}
	}
	return true
}

// withoutAttribution answers where the reply ends when a quotation starts at
// quote: above the attribution line the client wrote over the quotation, if
// there is one. An attribution ends in a colon and names the sender's address
// or says they wrote, which tells it from a line of the reader's own that
// introduces what they quote. A client that wraps a long one (Gmail wraps at
// 78 characters) moves the end of it to a line of its own, so the line above
// is part of the attribution when the address is there.
func withoutAttribution(lines []string, quote int) int {
	i := quote - 1
	for i >= 0 && strings.TrimSpace(lines[i]) == "" {
		i--
	}
	if i < 0 {
		return quote
	}
	last := strings.TrimSpace(lines[i])
	if !strings.HasSuffix(last, ":") && !strings.HasSuffix(last, "：") {
		return quote
	}
	if strings.Contains(last, "@") {
		return i
	}
	if i > 0 {
		previous := strings.TrimSpace(lines[i-1])
		if strings.Contains(previous, "@") && !isQuoted(previous) {
			return i - 1
		}
	}
	if wrotePattern.MatchString(last) {
		return i
	}
	return quote
}

func nextNonBlank(lines []string, start int) string {
	for _, line := range lines[start:] {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
