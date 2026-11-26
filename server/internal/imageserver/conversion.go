package imageserver

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const (
	formatAVIF = "image/avif"
	formatWebP = "image/webp"
)

// conversionRequest restates r as the conversion Manael makes of it, and
// nothing else: the Accept header names only the formats Manael would choose
// between, in the order it would try them, and the query holds only the
// transform that conversion applies, each value spelled one way. The cache key
// is taken from this request, so two requests Manael would answer with the
// same bytes share one entry however their Accept and query were spelled.
//
// contentType is the original's type as the origin hands it to Manael, empty
// when only the object store knows it.
//
// A w or h Manael would refuse is answered here with 400, before the original
// is read.
func conversionRequest(r *http.Request, contentType string) (*http.Request, error) {
	q := r.URL.Query()
	width, err := resizeDimension(q, "w")
	if err != nil {
		return nil, err
	}
	height, err := resizeDimension(q, "h")
	if err != nil {
		return nil, err
	}

	formats := candidateFormats(r.Header.Get("Accept"), strings.TrimSpace(contentType))
	out := url.Values{}
	// An original Manael passes through as it is gets neither a resize nor a
	// quality, so the transform it asked for names no rendition.
	if len(formats) > 0 {
		// Every resize is a scale-down, whatever fit was named. Manael's other
		// fits enlarge: contain, which is also what no fit means, scales a
		// small original up to the box asked for, and cover scales it up until
		// it covers the box before cropping. Either turns a 512px logo asked
		// for at w=16000&h=16000 into a 256-megapixel conversion. scale-down
		// never answers with more than the original, and it is the fit the web
		// apps and the viewer ask for.
		if width > 0 || height > 0 {
			out.Set("fit", resizeFitScaleDown)
		}
		if width > 0 {
			out.Set("w", strconv.Itoa(width))
		}
		if height > 0 {
			out.Set("h", strconv.Itoa(height))
		}
		if quality := qualityFor(q["q"], formats); quality != "" {
			out.Set("q", quality)
		}
	}

	u := *r.URL
	u.RawQuery = out.Encode()
	conv := r.Clone(r.Context())
	conv.URL = &u
	if len(formats) > 0 {
		conv.Header.Set("Accept", strings.Join(formats, ","))
	} else {
		conv.Header.Del("Accept")
	}
	return conv, nil
}

// resizeDimension reads w or h as Manael does: absent is 0, and anything but
// a positive integer no larger than maxResizeDimension is refused.
func resizeDimension(q url.Values, name string) (int, error) {
	raw := q.Get(name)
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 || n > maxResizeDimension {
		return 0, fmt.Errorf("invalid value for parameter %q: must be a positive integer no larger than %d", name, maxResizeDimension)
	}
	return n, nil
}

// candidateFormats lists the formats Manael may convert an original of
// contentType into for accept, in the order it tries them: it takes the first
// Accept entry that starts with image/avif or image/webp, converts only JPEG,
// PNG, and GIF, and never makes AVIF of a PNG or a GIF. An empty list is the
// original passed through as it is.
//
// With contentType known the list holds at most one format. With it unknown,
// AVIF named before WebP lists both, since which one Manael picks depends on
// the type the object store reports.
func candidateFormats(accept, contentType string) []string {
	avifAllowed := true
	switch contentType {
	case "":
	case "image/jpeg":
	case "image/png", "image/gif":
		avifAllowed = false
	default:
		return nil
	}
	var formats []string
	for entry := range strings.SplitSeq(accept, ",") {
		entry = strings.TrimSpace(entry)
		switch {
		case avifAllowed && strings.HasPrefix(entry, formatAVIF):
			if contentType != "" {
				return []string{formatAVIF}
			}
			if len(formats) == 0 {
				formats = append(formats, formatAVIF)
			}
		case strings.HasPrefix(entry, formatWebP):
			return append(formats, formatWebP)
		}
	}
	return formats
}

// qualityFor restates the q values Manael reads as the quality each of formats
// is encoded at, as format:quality pairs, or "" when none is named and
// Manael's own default for each format applies.
//
// Manael takes a bare number as the quality of every format and a
// webp:N or avif:N as that format's own, the latter winning; it clamps each to
// 1–100 and skips what it cannot read.
func qualityFor(values []string, formats []string) string {
	var universal, webp, avif int
	for _, value := range values {
		for token := range strings.SplitSeq(value, ",") {
			token = strings.TrimSpace(token)
			name, raw, scoped := strings.Cut(token, ":")
			if !scoped {
				raw = name
			}
			n, err := strconv.Atoi(strings.TrimSpace(raw))
			if err != nil {
				continue
			}
			n = min(max(n, 1), 100)
			switch {
			case !scoped:
				universal = n
			case strings.EqualFold(strings.TrimSpace(name), "webp"):
				webp = n
			case strings.EqualFold(strings.TrimSpace(name), "avif"):
				avif = n
			}
		}
	}

	pairs := make([]string, 0, len(formats))
	for _, format := range formats {
		name, n := "webp", webp
		if format == formatAVIF {
			name, n = "avif", avif
		}
		if n == 0 {
			n = universal
		}
		if n > 0 {
			pairs = append(pairs, name+":"+strconv.Itoa(n))
		}
	}
	return strings.Join(pairs, ",")
}
