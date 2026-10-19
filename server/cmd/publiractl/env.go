package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io/fs"
	"os"

	"github.com/publira/publira/server/internal/deployenv"
)

var envGroup = commandGroup{
	name:    "env",
	summary: "Write a deployment's .env with every secret generated",
	note:    "The env commands connect to nothing, so they run on a host that has nothing else yet.",
	commands: []command{
		{name: "generate", summary: "Write a .env from a template, generating every secret it lists", setup: setupEnvGenerate},
	},
}

func setupEnvGenerate(f *commandFlags) func(context.Context, *commandEnv) error {
	var templatePath, outputPath string
	f.StringVar(&templatePath, "template", ".env.example", "the `file` to copy, such as infra/deploy/.env.example")
	f.StringVar(&outputPath, "output", ".env", "the `file` to write, which must not exist")
	return func(_ context.Context, env *commandEnv) error {
		template, err := os.ReadFile(templatePath)
		if err != nil {
			return fmt.Errorf("--template: %w", err)
		}
		contents, filled, err := deployenv.Fill(template, rand.Reader)
		if err != nil {
			return err
		}
		if len(filled) == 0 {
			return fmt.Errorf("--template: %s sets none of the secrets publiractl generates", templatePath)
		}
		// Every secret of the install is in the file, so it is created readable
		// by its owner alone, and never written over a file that may hold the
		// keys an existing install's data is sealed with.
		file, err := os.OpenFile(outputPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if errors.Is(err, fs.ErrExist) {
			return fmt.Errorf("--output: %s exists; it may hold the secrets of an install, so it is never written over", outputPath)
		}
		if err != nil {
			return fmt.Errorf("--output: %w", err)
		}
		if _, err := file.Write(contents); err != nil {
			_ = file.Close()
			_ = os.Remove(outputPath)
			return fmt.Errorf("write %s: %w", outputPath, err)
		}
		if err := file.Close(); err != nil {
			_ = os.Remove(outputPath)
			return fmt.Errorf("write %s: %w", outputPath, err)
		}
		_, err = fmt.Fprintf(env.stdout, "Wrote %s with %d secrets generated.\n", outputPath, len(filled))
		return err
	}
}
