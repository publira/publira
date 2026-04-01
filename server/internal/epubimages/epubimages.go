package epubimages

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/publira/epub"

	"github.com/publira/publira/server/internal/archiveimages"
	"github.com/publira/publira/server/internal/imageproc"
)

func ExtractImageInputs(epubData []byte, maxEntries int) ([]archiveimages.Input, error) {
	doc, err := epub.Decode(bytes.NewReader(epubData), int64(len(epubData)), epub.WithCompliance(epub.LevelFlexible))
	if err != nil {
		return nil, fmt.Errorf("archive_data must be a valid epub file: %w", err)
	}
	if len(doc.Pages) == 0 {
		return nil, errors.New("epub contains no spine entries")
	}

	assetsByID := make(map[string]referencedAsset, len(doc.Assets))
	for href, asset := range doc.Assets {
		if asset == nil {
			continue
		}
		assetID := strings.TrimSpace(asset.ID)
		if assetID == "" {
			continue
		}
		normalizedHref, normalizeErr := normalizeEntryPath(href)
		if normalizeErr != nil {
			return nil, fmt.Errorf("epub manifest contains invalid path %q", href)
		}
		assetsByID[assetID] = referencedAsset{href: normalizedHref, asset: asset}
	}

	pages := make([]*epub.Page, 0, len(doc.Pages))
	pages = append(pages, doc.Pages...)
	sort.SliceStable(pages, func(i, j int) bool {
		left := pages[i]
		right := pages[j]
		if left == nil {
			return false
		}
		if right == nil {
			return true
		}
		return left.Order < right.Order
	})

	inputs := make([]archiveimages.Input, 0, len(pages))
	for index, page := range pages {
		if page == nil {
			return nil, fmt.Errorf("epub spine entry at index %d is nil", index)
		}
		assetID := strings.TrimSpace(page.AssetID)
		if assetID == "" {
			return nil, fmt.Errorf("epub spine entry at index %d has an empty asset_id", index)
		}
		ref, ok := assetsByID[assetID]
		if !ok {
			return nil, fmt.Errorf("epub spine references unknown asset_id %q", assetID)
		}
		if !assetIsImage(ref) {
			return nil, fmt.Errorf("epub spine asset %q is not an image", ref.href)
		}
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
		return nil, errors.New("epub contains no spine image assets")
	}

	return inputs, nil
}

type referencedAsset struct {
	href  string
	asset *epub.Asset
}

func assetIsImage(ref referencedAsset) bool {
	mimeType := strings.ToLower(strings.TrimSpace(ref.asset.MimeType))
	if strings.HasPrefix(mimeType, "image/") {
		return true
	}
	return entryIsImage(ref.href)
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

func entryIsImage(name string) bool {
	ext := strings.ToLower(name)
	return strings.HasSuffix(ext, ".png") || strings.HasSuffix(ext, ".jpg") || strings.HasSuffix(ext, ".jpeg") || strings.HasSuffix(ext, ".gif")
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
