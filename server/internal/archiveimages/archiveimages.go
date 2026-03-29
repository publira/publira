package archiveimages

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/publira/publira/server/internal/imageproc"
)

type Input struct {
	Filename    string
	ContentType string
	Data        []byte
}

func ExtractImageInputs(archiveData []byte, maxEntries int) ([]Input, error) {
	reader, err := zip.NewReader(bytes.NewReader(archiveData), int64(len(archiveData)))
	if err != nil {
		return nil, errors.New("archive_data must be a valid zip file")
	}

	inputs := make([]Input, 0, len(reader.File))
	for _, file := range reader.File {
		normalizedName, err := normalizeEntryPath(file.Name)
		if err != nil {
			return nil, err
		}
		if file.FileInfo().IsDir() {
			continue
		}
		if !entryIsImage(normalizedName) {
			continue
		}
		if len(inputs) >= maxEntries {
			return nil, fmt.Errorf("archive contains more than %d images", maxEntries)
		}
		if file.UncompressedSize64 > imageproc.MaxUploadBytes {
			return nil, fmt.Errorf("archive entry %q exceeds %d bytes", normalizedName, imageproc.MaxUploadBytes)
		}

		rc, err := file.Open()
		if err != nil {
			return nil, fmt.Errorf("open archive entry %q: %w", normalizedName, err)
		}
		data, err := io.ReadAll(io.LimitReader(rc, imageproc.MaxUploadBytes+1))
		closeErr := rc.Close()
		if err != nil {
			return nil, fmt.Errorf("read archive entry %q: %w", normalizedName, err)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("close archive entry %q: %w", normalizedName, closeErr)
		}
		if len(data) == 0 {
			return nil, fmt.Errorf("archive entry %q is empty", normalizedName)
		}
		if len(data) > imageproc.MaxUploadBytes {
			return nil, fmt.Errorf("archive entry %q exceeds %d bytes", normalizedName, imageproc.MaxUploadBytes)
		}

		inputs = append(inputs, Input{
			Filename:    normalizedName,
			ContentType: entryContentType(normalizedName),
			Data:        data,
		})
	}

	if len(inputs) == 0 {
		return nil, errors.New("archive contains no image files")
	}

	sort.Slice(inputs, func(i, j int) bool {
		return naturalLess(inputs[i].Filename, inputs[j].Filename)
	})

	return inputs, nil
}

func normalizeEntryPath(name string) (string, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	if normalized == "" {
		return "", errors.New("archive contains an empty path")
	}
	cleaned := path.Clean(normalized)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || strings.HasPrefix(cleaned, "/") {
		return "", fmt.Errorf("archive contains invalid path %q", name)
	}
	return cleaned, nil
}

func entryIsImage(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif":
		return true
	default:
		return false
	}
}

func entryContentType(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	default:
		return ""
	}
}

func isDigitByte(ch byte) bool {
	return ch >= '0' && ch <= '9'
}

func trimLeadingZeros(value string) string {
	trimmed := strings.TrimLeft(value, "0")
	if trimmed == "" {
		return "0"
	}
	return trimmed
}

func naturalLess(a, b string) bool {
	a = strings.ToLower(a)
	b = strings.ToLower(b)
	ai := 0
	bi := 0
	for ai < len(a) && bi < len(b) {
		if isDigitByte(a[ai]) && isDigitByte(b[bi]) {
			aStart := ai
			for ai < len(a) && isDigitByte(a[ai]) {
				ai++
			}
			bStart := bi
			for bi < len(b) && isDigitByte(b[bi]) {
				bi++
			}
			aNum := a[aStart:ai]
			bNum := b[bStart:bi]
			aNorm := trimLeadingZeros(aNum)
			bNorm := trimLeadingZeros(bNum)
			if len(aNorm) != len(bNorm) {
				return len(aNorm) < len(bNorm)
			}
			if aNorm != bNorm {
				return aNorm < bNorm
			}
			if len(aNum) != len(bNum) {
				return len(aNum) < len(bNum)
			}
			continue
		}
		if a[ai] != b[bi] {
			return a[ai] < b[bi]
		}
		ai++
		bi++
	}
	return len(a) < len(b)
}
