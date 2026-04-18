package bots

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const feishuAudioTranscodeTimeout = 30 * time.Second

var (
	lookPathFeishuAudioCommand = exec.LookPath
	execFeishuAudioCommand     = exec.CommandContext
)

func transcodeFeishuAudioToOpus(ctx context.Context, audio []byte, fileName string) ([]byte, string, string, error) {
	if len(audio) == 0 {
		return nil, "", "", fmt.Errorf("%w: feishu voice/audio data is empty", ErrInvalidInput)
	}

	transcodeCtx := ctx
	var cancel context.CancelFunc
	if transcodeCtx == nil {
		transcodeCtx = context.Background()
	}
	if _, hasDeadline := transcodeCtx.Deadline(); !hasDeadline {
		transcodeCtx, cancel = context.WithTimeout(transcodeCtx, feishuAudioTranscodeTimeout)
		defer cancel()
	}

	ffmpegCommand := strings.TrimSpace(firstNonEmpty(os.Getenv("CODEX_FEISHU_FFMPEG"), "ffmpeg"))
	commandPath, err := lookPathFeishuAudioCommand(ffmpegCommand)
	if err != nil {
		return nil, "", "", fmt.Errorf("ffmpeg not found in PATH: install ffmpeg to enable Feishu voice/audio conversion")
	}

	command := execFeishuAudioCommand(
		transcodeCtx,
		commandPath,
		"-i", "pipe:0",
		"-c:a", "libopus",
		"-f", "opus",
		"-y",
		"pipe:1",
	)
	command.Stdin = bytes.NewReader(audio)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr

	if err := command.Run(); err != nil {
		return nil, "", "", fmt.Errorf("ffmpeg opus conversion failed: %w: %s", err, compactFeishuAudioCommandOutput(stderr.Bytes()))
	}
	if stdout.Len() == 0 {
		return nil, "", "", fmt.Errorf("ffmpeg opus conversion produced empty output")
	}

	outputName := strings.TrimSpace(fileName)
	if outputName == "" {
		outputName = "tts_audio.opus"
	} else {
		outputName = strings.TrimSuffix(outputName, filepath.Ext(outputName)) + ".opus"
	}
	return stdout.Bytes(), outputName, "audio/ogg", nil
}

func compactFeishuAudioCommandOutput(output []byte) string {
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
