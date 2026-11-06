package epubimages

import (
	"archive/zip"
	"bytes"
	"io"
	"regexp"
	"strings"
	"testing"

	"github.com/publira/epub"
)

const testMaxBytes = 1 << 20

var oneByOnePNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
	0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
}

func TestExtractImageInputsFromEPUB(t *testing.T) {
	archive := makeEPUBArchive(t, oneByOnePNG, oneByOnePNG)

	inputs, err := ExtractImageInputs(archive, 10, testMaxBytes)
	if err != nil {
		t.Fatalf("ExtractImageInputs: %v", err)
	}
	if len(inputs) != 2 {
		t.Fatalf("len(inputs) = %d, want 2", len(inputs))
	}
	for index, input := range inputs {
		if input.Filename == "" {
			t.Fatalf("inputs[%d].Filename is empty", index)
		}
		if !strings.HasPrefix(input.ContentType, "image/") {
			t.Fatalf("inputs[%d].ContentType = %q, want image/*", index, input.ContentType)
		}
		if len(input.Data) == 0 {
			t.Fatalf("inputs[%d].Data is empty", index)
		}
	}
}

func TestExtractImageInputsFromBrokenEPUB(t *testing.T) {
	_, err := ExtractImageInputs([]byte("not-an-epub"), 10, testMaxBytes)
	if err == nil {
		t.Fatal("ExtractImageInputs error = nil, want error")
	}
}

func TestExtractImageInputsRejectsEPUBSpineReferenceMismatch(t *testing.T) {
	archive := makeEPUBArchive(t, oneByOnePNG)
	corrupted := corruptEPUBSpineReference(t, archive)

	_, err := ExtractImageInputs(corrupted, 10, testMaxBytes)
	if err == nil {
		t.Fatal("ExtractImageInputs error = nil, want error")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "spine") {
		t.Fatalf("error = %v, want spine reference error", err)
	}
}

// paddedPNG is a PNG of the given size whose tail is a run of zeros, which is
// what deflate shrinks furthest.
func paddedPNG(size int) []byte {
	return append(bytes.Clone(oneByOnePNG), make([]byte, size-len(oneByOnePNG))...)
}

func TestExtractImageInputsRefusesAHighlyCompressibleEPUB(t *testing.T) {
	const page = 1 << 20
	archive := makeEPUBArchive(t, paddedPNG(page), paddedPNG(page), paddedPNG(page), paddedPNG(page))
	if len(archive) >= page {
		t.Fatalf("the ePub is %d bytes, want it far smaller than what it unpacks to", len(archive))
	}

	_, err := ExtractImageInputs(archive, 10, 3*page)
	if err == nil || !strings.Contains(err.Error(), "unpacks to more than") {
		t.Fatalf("ExtractImageInputs error = %v, want it refused for what it unpacks to", err)
	}
	if _, ok := RejectionOf(err); ok {
		t.Errorf("error = %v, want the refusal of too many images rather than an invalid ePub", err)
	}

	inputs, err := ExtractImageInputs(archive, 10, 5*page)
	if err != nil || len(inputs) != 4 {
		t.Fatalf("under the bound: %d inputs, %v, want all four", len(inputs), err)
	}
}

// Decoding inflates every entry of the manifest, so what no page shows counts
// too: this one would never reach the pages' own total.
func TestExtractImageInputsCountsWhatNoPageShows(t *testing.T) {
	const size = 1 << 20
	doc := &epub.Document{Title: "Episode", Direction: "rtl", Layout: epub.LayoutPrePaginated}
	if _, _, err := doc.AddPageWithAsset(bytes.NewReader(oneByOnePNG), int64(len(oneByOnePNG)), "right"); err != nil {
		t.Fatalf("doc.AddPageWithAsset: %v", err)
	}
	if _, _, err := doc.AddAsset("image/png", bytes.NewReader(paddedPNG(size)), size); err != nil {
		t.Fatalf("doc.AddAsset: %v", err)
	}
	var buf bytes.Buffer
	if err := epub.Encode(&buf, doc); err != nil {
		t.Fatalf("epub.Encode: %v", err)
	}

	_, err := ExtractImageInputs(buf.Bytes(), 10, size)
	if err == nil || !strings.Contains(err.Error(), "unpacks to more than") {
		t.Fatalf("ExtractImageInputs error = %v, want it refused for what it unpacks to", err)
	}
}

// The ePub itself holds one image, so nothing but counting each page the spine
// shows sees what it adds up to.
func TestExtractImageInputsCountsAnImageTheSpineRepeats(t *testing.T) {
	const page = 1 << 20
	archive := repeatEPUBSpine(t, makeEPUBArchive(t, paddedPNG(page)), 4)

	_, err := ExtractImageInputs(archive, 10, 3*page)
	if err == nil || !strings.Contains(err.Error(), "unpacks to more than") {
		t.Fatalf("ExtractImageInputs error = %v, want it refused for what it unpacks to", err)
	}

	inputs, err := ExtractImageInputs(archive, 10, 4*page)
	if err != nil || len(inputs) != 4 {
		t.Fatalf("at the bound: %d inputs, %v, want all four", len(inputs), err)
	}
}

func makeEPUBArchive(t *testing.T, images ...[]byte) []byte {
	t.Helper()
	doc := &epub.Document{Title: "Episode", Direction: "rtl", Layout: epub.LayoutPrePaginated}
	for _, raw := range images {
		if _, _, err := doc.AddPageWithAsset(bytes.NewReader(raw), int64(len(raw)), "right"); err != nil {
			t.Fatalf("doc.AddPageWithAsset: %v", err)
		}
	}
	var buf bytes.Buffer
	if err := epub.Encode(&buf, doc); err != nil {
		t.Fatalf("epub.Encode: %v", err)
	}
	return buf.Bytes()
}

func corruptEPUBSpineReference(t *testing.T, archive []byte) []byte {
	t.Helper()
	spineRefPattern := regexp.MustCompile(`idref="[^"]+"`)
	return rewriteEPUBPackage(t, archive, func(opf []byte) []byte {
		return spineRefPattern.ReplaceAll(opf, []byte(`idref="missing-asset-id"`))
	})
}

// repeatEPUBSpine makes the spine show its pages the given number of times over.
func repeatEPUBSpine(t *testing.T, archive []byte, times int) []byte {
	t.Helper()
	itemrefPattern := regexp.MustCompile(`<itemref\b.*?(?:/>|</itemref>)`)
	return rewriteEPUBPackage(t, archive, func(opf []byte) []byte {
		return itemrefPattern.ReplaceAllFunc(opf, func(itemref []byte) []byte {
			return bytes.Repeat(itemref, times)
		})
	})
}

func rewriteEPUBPackage(t *testing.T, archive []byte, rewrite func(opf []byte) []byte) []byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("zip.NewReader: %v", err)
	}

	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	packageRewritten := false

	for _, file := range reader.File {
		rc, openErr := file.Open()
		if openErr != nil {
			t.Fatalf("file.Open(%q): %v", file.Name, openErr)
		}
		data, readErr := io.ReadAll(rc)
		closeErr := rc.Close()
		if readErr != nil {
			t.Fatalf("io.ReadAll(%q): %v", file.Name, readErr)
		}
		if closeErr != nil {
			t.Fatalf("rc.Close(%q): %v", file.Name, closeErr)
		}

		if strings.HasSuffix(strings.ToLower(file.Name), ".opf") && !packageRewritten {
			replaced := rewrite(data)
			if !bytes.Equal(replaced, data) {
				data = replaced
				packageRewritten = true
			}
		}

		header := file.FileHeader
		header.Name = file.Name
		header.Method = file.Method
		w, createErr := writer.CreateHeader(&header)
		if createErr != nil {
			t.Fatalf("writer.Create(%q): %v", file.Name, createErr)
		}
		if _, writeErr := w.Write(data); writeErr != nil {
			t.Fatalf("w.Write(%q): %v", file.Name, writeErr)
		}
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close: %v", err)
	}
	if !packageRewritten {
		t.Fatal("failed to rewrite the OPF")
	}

	return out.Bytes()
}
