package archiveimages

import (
	"archive/zip"
	"bytes"
	"testing"
)

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

	inputs, err := ExtractImageInputs(archive, 10)
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

	_, err := ExtractImageInputs(archive, 10)
	if err == nil {
		t.Fatal("ExtractImageInputs error = nil, want error")
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
