package inboundprovider

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/text/encoding/htmlindex"
)

const (
	// maxPartBytes bounds how much of one body part is read. The stored entry
	// keeps at most 4000 characters of it, so anything past this is quoted
	// history or an attachment mislabelled as text.
	maxPartBytes = 1 << 20
	// maxMultipartDepth bounds how deep nested multipart bodies are walked.
	maxMultipartDepth = 8
)

var wordDecoder = &mime.WordDecoder{CharsetReader: charsetReader}

// charsetReader reads input in the charset a MIME header or part names as
// UTF-8, for the charsets the WHATWG encoding standard knows.
func charsetReader(charset string, input io.Reader) (io.Reader, error) {
	encoding, err := htmlindex.Get(strings.TrimSpace(charset))
	if err != nil {
		return nil, fmt.Errorf("unsupported charset %q", charset)
	}
	return encoding.NewDecoder().Reader(input), nil
}

// DecodeCharset answers data, written in charset, as UTF-8. An empty charset,
// or one naming UTF-8 or ASCII, takes data as it is.
func DecodeCharset(data []byte, charset string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(charset)) {
	case "", "utf-8", "utf8", "us-ascii", "ascii":
		return strings.ToValidUTF8(string(data), "�"), nil
	}
	reader, err := charsetReader(charset, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	decoded, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	return string(decoded), nil
}

// DecodeHeader answers a header value with its RFC 2047 encoded words decoded.
// A value that does not decode is answered as it was received.
func DecodeHeader(value string) string {
	decoded, err := wordDecoder.DecodeHeader(value)
	if err != nil {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(decoded)
}

// ParseAddress answers the bare address of one mailbox, such as
// "a@example.com" from `"A" <a@example.com>`.
func ParseAddress(value string) (string, bool) {
	parser := mail.AddressParser{WordDecoder: wordDecoder}
	address, err := parser.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", false
	}
	return address.Address, true
}

// ParseAddressList answers the bare addresses of a list of mailboxes. A list
// that does not parse as a whole is read one comma-separated item at a time,
// so one malformed entry does not hide the others.
func ParseAddressList(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parser := mail.AddressParser{WordDecoder: wordDecoder}
	if list, err := parser.ParseList(value); err == nil {
		addresses := make([]string, 0, len(list))
		for _, address := range list {
			addresses = append(addresses, address.Address)
		}
		return addresses
	}
	var addresses []string
	for item := range strings.SplitSeq(value, ",") {
		if address, ok := ParseAddress(item); ok {
			addresses = append(addresses, address)
		}
	}
	return addresses
}

// AppendRecipients appends the addresses to recipients, leaving out the ones
// already there in any case.
func AppendRecipients(recipients []string, addresses ...string) []string {
	for _, address := range addresses {
		address = strings.TrimSpace(address)
		if address == "" {
			continue
		}
		duplicate := false
		for _, existing := range recipients {
			if strings.EqualFold(existing, address) {
				duplicate = true
				break
			}
		}
		if !duplicate {
			recipients = append(recipients, address)
		}
	}
	return recipients
}

// ParseMessageIDs answers the ids a Message-ID, In-Reply-To, or References
// header names, without their angle brackets, in the order it names them. A
// value with no angle brackets at all, which some mailers write, is read as
// whitespace-separated ids.
func ParseMessageIDs(value string) []string {
	var ids []string
	rest := value
	for {
		start := strings.IndexByte(rest, '<')
		if start < 0 {
			break
		}
		end := strings.IndexByte(rest[start:], '>')
		if end < 0 {
			break
		}
		if id := strings.TrimSpace(rest[start+1 : start+end]); id != "" {
			ids = append(ids, id)
		}
		rest = rest[start+end+1:]
	}
	if len(ids) > 0 || strings.ContainsAny(value, "<>") {
		return ids
	}
	return strings.Fields(value)
}

// ParseMessageID answers the one id a Message-ID header names, or the empty
// string for a header that names none.
func ParseMessageID(value string) string {
	ids := ParseMessageIDs(value)
	if len(ids) == 0 {
		return ""
	}
	return ids[0]
}

// ApplyHeader fills in the parts of msg a mail's header carries: the subject,
// the sender when msg has none yet, the To and Cc recipients, and the id
// headers.
func ApplyHeader(msg *Message, header mail.Header) {
	if subject := header.Get("Subject"); subject != "" {
		msg.Subject = DecodeHeader(subject)
	}
	if msg.From == "" {
		if from, ok := ParseAddress(header.Get("From")); ok {
			msg.From = from
		}
	}
	msg.Recipients = AppendRecipients(msg.Recipients, ParseAddressList(header.Get("To"))...)
	msg.Recipients = AppendRecipients(msg.Recipients, ParseAddressList(header.Get("Cc"))...)
	if id := ParseMessageID(header.Get("Message-Id")); id != "" {
		msg.MessageID = id
	}
	msg.InReplyTo = ParseMessageIDs(header.Get("In-Reply-To"))
	msg.References = ParseMessageIDs(header.Get("References"))
}

// ReadHeaderBlock reads a raw header block, as SendGrid posts it apart from the
// body.
func ReadHeaderBlock(raw string) (mail.Header, error) {
	raw = strings.TrimRight(raw, "\r\n")
	msg, err := mail.ReadMessage(strings.NewReader(raw + "\r\n\r\n"))
	if err != nil {
		return nil, err
	}
	return msg.Header, nil
}

// ReadMIME reads a whole RFC 5322 mail and answers its header and the text of
// its body: the plain-text part when it has one, and a text rendering of the
// HTML part otherwise. Attachments are not read.
func ReadMIME(raw []byte) (mail.Header, string, error) {
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return nil, "", err
	}
	plain, htmlText, err := readPart(
		msg.Header.Get("Content-Type"),
		msg.Header.Get("Content-Transfer-Encoding"),
		msg.Body,
		0,
	)
	if err != nil {
		return nil, "", err
	}
	if plain != "" {
		return msg.Header, plain, nil
	}
	return msg.Header, HTMLToText(htmlText), nil
}

// readPart answers the first plain-text and the first HTML body inside one
// part, decoded to UTF-8.
func readPart(contentType, transferEncoding string, body io.Reader, depth int) (string, string, error) {
	if depth > maxMultipartDepth {
		return "", "", errors.New("mail nests multipart bodies too deeply")
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = "text/plain"
	}
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		// A part whose type does not parse is read as plain text, which is
		// what RFC 2045 makes of a part that names no type.
		mediaType, params = "text/plain", map[string]string{}
	}
	if strings.HasPrefix(mediaType, "multipart/") {
		boundary := params["boundary"]
		if boundary == "" {
			return "", "", errors.New("multipart body names no boundary")
		}
		reader := multipart.NewReader(body, boundary)
		var plain, htmlText string
		for {
			part, err := reader.NextRawPart()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				return "", "", fmt.Errorf("read multipart body: %w", err)
			}
			if disposition, _, err := mime.ParseMediaType(part.Header.Get("Content-Disposition")); err == nil && disposition == "attachment" {
				continue
			}
			partPlain, partHTML, err := readPart(
				part.Header.Get("Content-Type"),
				part.Header.Get("Content-Transfer-Encoding"),
				part,
				depth+1,
			)
			if err != nil {
				return "", "", err
			}
			if plain == "" {
				plain = partPlain
			}
			if htmlText == "" {
				htmlText = partHTML
			}
		}
		return plain, htmlText, nil
	}
	if mediaType != "text/plain" && mediaType != "text/html" {
		return "", "", nil
	}
	decoded, err := io.ReadAll(io.LimitReader(decodeTransfer(body, transferEncoding), maxPartBytes))
	if err != nil {
		return "", "", fmt.Errorf("decode %s part: %w", mediaType, err)
	}
	text, err := DecodeCharset(decoded, params["charset"])
	if err != nil {
		return "", "", err
	}
	if mediaType == "text/html" {
		return "", text, nil
	}
	return text, "", nil
}

func decodeTransfer(body io.Reader, transferEncoding string) io.Reader {
	switch strings.ToLower(strings.TrimSpace(transferEncoding)) {
	case "base64":
		return base64.NewDecoder(base64.StdEncoding, body)
	case "quoted-printable":
		return quotedprintable.NewReader(body)
	default:
		return body
	}
}

// HTMLToText renders an HTML body as the plain text a mail client would show
// for it: block elements on lines of their own, and a blockquote's lines
// prefixed with "> ", so that [StripQuoted] recognises a quotation in a mail
// that has no plain-text part.
func HTMLToText(source string) string {
	if strings.TrimSpace(source) == "" {
		return ""
	}
	root, err := html.Parse(strings.NewReader(source))
	if err != nil {
		return ""
	}
	var b strings.Builder
	renderHTML(&b, root)
	return tidyLines(b.String())
}

var blockElements = map[string]bool{
	"address": true, "article": true, "aside": true, "dd": true, "div": true,
	"dl": true, "dt": true, "footer": true, "h1": true, "h2": true, "h3": true,
	"h4": true, "h5": true, "h6": true, "header": true, "hr": true, "li": true,
	"main": true, "nav": true, "ol": true, "p": true, "pre": true,
	"section": true, "table": true, "tr": true, "ul": true,
}

func renderHTML(b *strings.Builder, node *html.Node) {
	switch node.Type {
	case html.TextNode:
		b.WriteString(strings.Join(strings.Fields(node.Data), " "))
		if strings.HasSuffix(node.Data, " ") || strings.HasSuffix(node.Data, "\n") {
			b.WriteByte(' ')
		}
		return
	case html.ElementNode:
		switch node.Data {
		case "head", "script", "style", "title":
			return
		case "br":
			b.WriteByte('\n')
			return
		case "blockquote":
			var inner strings.Builder
			for child := node.FirstChild; child != nil; child = child.NextSibling {
				renderHTML(&inner, child)
			}
			b.WriteByte('\n')
			for line := range strings.SplitSeq(tidyLines(inner.String()), "\n") {
				b.WriteString("> ")
				b.WriteString(line)
				b.WriteByte('\n')
			}
			return
		}
	}
	block := node.Type == html.ElementNode && blockElements[node.Data]
	if block {
		b.WriteByte('\n')
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		renderHTML(b, child)
	}
	if block {
		b.WriteByte('\n')
	}
}

// tidyLines trims each line's trailing space and leading space left by the
// renderer, and collapses runs of blank lines into one.
func tidyLines(text string) string {
	var lines []string
	blank := false
	for line := range strings.SplitSeq(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			if !blank && len(lines) > 0 {
				lines = append(lines, "")
			}
			blank = true
			continue
		}
		blank = false
		lines = append(lines, line)
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

// ValidText answers whether s may be stored as text: valid UTF-8 with no NUL,
// which PostgreSQL text cannot hold.
func ValidText(s string) bool {
	return utf8.ValidString(s) && !strings.ContainsRune(s, 0)
}
