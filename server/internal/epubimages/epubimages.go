package epubimages

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/publira/epub"

	"github.com/publira/publira/server/internal/archiveimages"
	"github.com/publira/publira/server/internal/imageproc"
)

// Rejection identifies an ePub failure that callers present specially.
type Rejection string

const (
	RejectionInvalidEPUB      Rejection = "invalid_epub"
	RejectionInvalidEPUBSpine Rejection = "invalid_epub_spine"
	RejectionInvalidPath      Rejection = "invalid_path"
)

type rejectionError struct {
	err       error
	rejection Rejection
}

func (e *rejectionError) Error() string { return e.err.Error() }

func (e *rejectionError) Unwrap() error { return e.err }

// RejectionOf returns the stable category without requiring callers to inspect
// the user-facing error text.
func RejectionOf(err error) (Rejection, bool) {
	var rejectionErr *rejectionError
	if !errors.As(err, &rejectionErr) {
		return "", false
	}
	return rejectionErr.rejection, true
}

func ExtractImageInputs(epubData []byte, maxEntries int) ([]archiveimages.Input, error) {
	doc, err := epub.Decode(bytes.NewReader(epubData), int64(len(epubData)))
	if err != nil {
		return nil, &rejectionError{
			err:       fmt.Errorf("archive_data must be a valid epub file: %w", err),
			rejection: RejectionInvalidEPUB,
		}
	}
	if len(doc.Pages) == 0 {
		return nil, &rejectionError{
			err:       errors.New("epub contains no spine entries"),
			rejection: RejectionInvalidEPUBSpine,
		}
	}

	spineRefs, err := doc.ExtractReferencedImagesFromSpine()
	if err != nil {
		return nil, &rejectionError{
			err:       fmt.Errorf("invalid epub spine reference: %w", err),
			rejection: RejectionInvalidEPUBSpine,
		}
	}

	inputs := make([]archiveimages.Input, 0, len(spineRefs))
	for _, spineRef := range spineRefs {
		if spineRef.Asset == nil {
			return nil, &rejectionError{
				err:       errors.New("epub spine references a nil asset"),
				rejection: RejectionInvalidEPUBSpine,
			}
		}
		href, normalizeErr := normalizeEntryPath(spineRef.Href)
		if normalizeErr != nil {
			return nil, &rejectionError{
				err:       fmt.Errorf("epub manifest contains invalid path %q", spineRef.Href),
				rejection: RejectionInvalidPath,
			}
		}
		ref := referencedAsset{href: href, asset: spineRef.Asset}
		if len(inputs) >= maxEntries {
			return nil, fmt.Errorf("archive contains more than %d images", maxEntries)
		}

		data, readErr := readAssetData(ref)
		if readErr != nil {
			return nil, readErr
		}

		contentType := strings.TrimSpace(ref.asset.MimeType)
		if contentType == "" {
			contentType = entryContentType(ref.href)
		}
		if contentType == "" {
			contentType = http.DetectContentType(data)
		}

		inputs = append(inputs, archiveimages.Input{Filename: ref.href, ContentType: contentType, Data: data})
	}

	if len(inputs) == 0 {
		return nil, &rejectionError{
			err:       errors.New("epub contains no spine image assets"),
			rejection: RejectionInvalidEPUBSpine,
		}
	}

	return inputs, nil
}

type referencedAsset struct {
	href  string
	asset *epub.Asset
}

func readAssetData(ref referencedAsset) ([]byte, error) {
	rc, err := ref.asset.Open()
	if err != nil {
		return nil, fmt.Errorf("open epub asset %q: %w", ref.href, err)
	}
	data, err := io.ReadAll(io.LimitReader(rc, imageproc.MaxUploadBytes+1))
	closeErr := rc.Close()
	if err != nil {
		return nil, fmt.Errorf("read epub asset %q: %w", ref.href, err)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("close epub asset %q: %w", ref.href, closeErr)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("epub asset %q is empty", ref.href)
	}
	if len(data) > imageproc.MaxUploadBytes {
		return nil, fmt.Errorf("epub asset %q exceeds %d bytes", ref.href, imageproc.MaxUploadBytes)
	}
	return data, nil
}

func normalizeEntryPath(name string) (string, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	if normalized == "" {
		return "", errors.New("archive contains an empty path")
	}
	cleaned := strings.TrimPrefix(strings.ReplaceAll(normalized, "\\", "/"), "./")
	if cleaned == "" || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || strings.HasPrefix(cleaned, "/") {
		return "", fmt.Errorf("archive contains invalid path %q", name)
	}
	return cleaned, nil
}

func entryContentType(name string) string {
	ext := strings.ToLower(name)
	switch {
	case strings.HasSuffix(ext, ".png"):
		return "image/png"
	case strings.HasSuffix(ext, ".jpg"), strings.HasSuffix(ext, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(ext, ".gif"):
		return "image/gif"
	default:
		return ""
	}
}
