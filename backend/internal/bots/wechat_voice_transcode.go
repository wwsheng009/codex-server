package bots

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const wechatVoiceTranscodeTimeout = 15 * time.Second

type wechatVoiceTranscodeCandidate struct {
	command string
	args    func(inputPath string, outputPath string) []string
}

var (
	lookPathWeChatVoiceCommand = exec.LookPath
	execWeChatVoiceCommand     = exec.CommandContext
)

func transcodeWeChatVoiceToWAV(ctx context.Context, silkPath string) (string, error) {
	silkPath = strings.TrimSpace(silkPath)
	if silkPath == "" {
		return "", errors.New("wechat voice path is required")
	}
	if _, err := os.Stat(silkPath); err != nil {
		return "", fmt.Errorf("stat wechat voice file %q: %w", silkPath, err)
	}

	outputPath := strings.TrimSuffix(silkPath, filepath.Ext(silkPath)) + ".wav"
	candidates := wechatVoiceTranscodeCandidates()
	if len(candidates) == 0 {
		return "", errors.New("no wechat voice decoder command was configured")
	}

	errs := make([]error, 0, len(candidates))
	for _, candidate := range candidates {
		if err := runWeChatVoiceTranscodeCandidate(ctx, candidate, silkPath, outputPath); err != nil {
			errs = append(errs, err)
			continue
		}
		return outputPath, nil
	}

	return "", errors.Join(errs...)
}

func wechatVoiceTranscodeCandidates() []wechatVoiceTranscodeCandidate {
	candidates := make([]wechatVoiceTranscodeCandidate, 0, 4)
	if decoderPath := strings.TrimSpace(firstNonEmpty(
		os.Getenv("CODEX_WECHAT_SILK_DECODER"),
		os.Getenv("CODEX_WECHAT_VOICE_DECODER"),
	)); decoderPath != "" {
		candidates = append(candidates, wechatVoiceTranscodeCandidate{
			command: decoderPath,
			args: func(inputPath string, outputPath string) []string {
				return []string{inputPath, outputPath}
			},
		})
	}

	candidates = append(candidates,
		wechatVoiceTranscodeCandidate{
			command: "silk_v3_decoder",
			args: func(inputPath string, outputPath string) []string {
				return []string{inputPath, outputPath}
			},
		},
		wechatVoiceTranscodeCandidate{
			command: "ffmpeg",
			args: func(inputPath string, outputPath string) []string {
				return []string{"-y", "-i", inputPath, outputPath}
			},
		},
	)

	return candidates
}

func runWeChatVoiceTranscodeCandidate(
	ctx context.Context,
	candidate wechatVoiceTranscodeCandidate,
	inputPath string,
	outputPath string,
) error {
	commandPath, err := lookPathWeChatVoiceCommand(candidate.command)
	if err != nil {
		return fmt.Errorf("%s was not found: %w", candidate.command, err)
	}

	_ = os.Remove(outputPath)
	command := execWeChatVoiceCommand(ctx, commandPath, candidate.args(inputPath, outputPath)...)
	output, err := command.CombinedOutput()
	if err != nil {
		_ = os.Remove(outputPath)
		return fmt.Errorf("%s failed: %w: %s", candidate.command, err, compactWeChatVoiceCommandOutput(output))
	}

	info, statErr := os.Stat(outputPath)
	if statErr != nil {
		return fmt.Errorf("%s did not produce %q: %w", candidate.command, outputPath, statErr)
	}
	if info.Size() == 0 {
		_ = os.Remove(outputPath)
		return fmt.Errorf("%s produced an empty wav file", candidate.command)
	}
	return nil
}

func compactWeChatVoiceCommandOutput(output []byte) string {
	text := strings.TrimSpace(string(output))
	if text == "" {
		return "no stderr output"
	}
	runes := []rune(text)
	if len(runes) > 240 {
		return string(runes[:240]) + "..."
	}
	return text
}
