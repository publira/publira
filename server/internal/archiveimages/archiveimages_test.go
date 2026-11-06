package archiveimages

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
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

func TestExtractImageInputsSortsNaturally(t *testing.T) {
	archive := makeZipArchive(t,
		archiveEntry{name: "010.png", data: oneByOnePNG},
		archiveEntry{name: "002.png", data: oneByOnePNG},
	)

	inputs, err := ExtractImageInputs(archive, 10, testMaxBytes)
	if err != nil {
		t.Fatalf("ExtractImageInputs: %v", err)
	}
	if len(inputs) != 2 {
		t.Fatalf("len(inputs) = %d, want 2", len(inputs))
	}
	if inputs[0].Filename != "002.png" {
		t.Fatalf("inputs[0].Filename = %q, want 002.png", inputs[0].Filename)
	}
	if inputs[1].Filename != "010.png" {
		t.Fatalf("inputs[1].Filename = %q, want 010.png", inputs[1].Filename)
	}
}

func TestExtractImageInputsRejectsTraversal(t *testing.T) {
	archive := makeZipArchive(t, archiveEntry{name: "../001.png", data: oneByOnePNG})

	_, err := ExtractImageInputs(archive, 10, testMaxBytes)
	if err == nil {
		t.Fatal("ExtractImageInputs error = nil, want error")
	}
}

func TestExtractImageInputsRefusesAHighlyCompressibleArchive(t *testing.T) {
	const page = 1 << 20
	zeros := make([]byte, page)
	archive := makeZipArchive(t,
		archiveEntry{name: "001.png", data: zeros},
		archiveEntry{name: "002.png", data: zeros},
		archiveEntry{name: "003.png", data: zeros},
		archiveEntry{name: "004.png", data: zeros},
	)
	if len(archive) >= page {
		t.Fatalf("the archive is %d bytes, want it far smaller than what it unpacks to", len(archive))
	}

	_, err := ExtractImageInputs(archive, 10, 4*page-1)
	if err == nil || !strings.Contains(err.Error(), "unpacks to more than") {
		t.Fatalf("ExtractImageInputs error = %v, want it refused for what it unpacks to", err)
	}

	inputs, err := ExtractImageInputs(archive, 10, 4*page)
	if err != nil || len(inputs) != 4 {
		t.Fatalf("at the bound: %d inputs, %v, want all four", len(inputs), err)
	}
}

// The entry that crosses the bound holds no deflate stream, so reading it would
// answer with a read error instead of the refusal.
func TestExtractImageInputsRefusesBeforeReadingTheEntryPastTheBound(t *testing.T) {
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	first, err := writer.Create("001.png")
	if err != nil {
		t.Fatalf("writer.Create: %v", err)
	}
	if _, err := first.Write(oneByOnePNG); err != nil {
		t.Fatalf("first.Write: %v", err)
	}
	second, err := writer.CreateRaw(&zip.FileHeader{
		Name:               "002.png",
		Method:             zip.Deflate,
		CompressedSize64:   4,
		UncompressedSize64: 1 << 10,
	})
	if err != nil {
		t.Fatalf("writer.CreateRaw: %v", err)
	}
	if _, err := second.Write([]byte{0xff, 0xff, 0xff, 0xff}); err != nil {
		t.Fatalf("second.Write: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close: %v", err)
	}

	_, err = ExtractImageInputs(buf.Bytes(), 10, 1<<10)
	if err == nil || !strings.Contains(err.Error(), "unpacks to more than") {
		t.Fatalf("ExtractImageInputs error = %v, want it refused for what it unpacks to", err)
	}
}

// Only the images are unpacked, so nothing else in the archive counts.
func TestExtractImageInputsLeavesOtherEntriesOutOfTheBound(t *testing.T) {
	archive := makeZipArchive(t,
		archiveEntry{name: "notes.txt", data: make([]byte, 1<<10)},
		archiveEntry{name: "001.png", data: oneByOnePNG},
	)

	inputs, err := ExtractImageInputs(archive, 10, uint64(len(oneByOnePNG)))
	if err != nil || len(inputs) != 1 {
		t.Fatalf("got %d inputs, %v, want the one image", len(inputs), err)
	}
}

type archiveEntry struct {
	name string
	data []byte
}

func makeZipArchive(t *testing.T, entries ...archiveEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for _, entry := range entries {
		fileWriter, err := writer.Create(entry.name)
		if err != nil {
			t.Fatalf("writer.Create(%q): %v", entry.name, err)
		}
		if _, err := fileWriter.Write(entry.data); err != nil {
			t.Fatalf("fileWriter.Write(%q): %v", entry.name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close: %v", err)
	}
	return buf.Bytes()
}
