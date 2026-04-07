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

const wechatRemoteVideoTranscodeTimeout = 2 * time.Minute

type wechatRemoteVideoTranscodeCandidate struct {
	label   string
	command string
	args    func(inputURL string, outputPath string) []string
}

var (
	lookPathWeChatVideoCommand = exec.LookPath
	execWeChatVideoCommand     = exec.CommandContext
)

func transcodeWeChatRemoteVideoToMP4(ctx context.Context, rawURL string, fileNameHint string) (string, string, func(), error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", "", nil, errors.New("wechat remote video url is required")
	}

	transcodeCtx := ctx
	if transcodeCtx == nil {
		transcodeCtx = context.Background()
	}
	var cancel context.CancelFunc
	if _, hasDeadline := transcodeCtx.Deadline(); !hasDeadline {
		transcodeCtx, cancel = context.WithTimeout(transcodeCtx, wechatRemoteVideoTranscodeTimeout)
		defer cancel()
	}

	candidates := wechatRemoteVideoTranscodeCandidates()
	if len(candidates) == 0 {
		return "", "", nil, errors.New("no wechat remote video transcoder command was configured")
	}

	outputPath, cleanup, err := allocateWeChatRemoteVideoOutputPath(fileNameHint)
	if err != nil {
		return "", "", nil, err
	}

	errs := make([]error, 0, len(candidates))
	for _, candidate := range candidates {
		if err := runWeChatRemoteVideoTranscodeCandidate(transcodeCtx, candidate, rawURL, outputPath); err != nil {
			errs = append(errs, err)
			continue
		}
		return outputPath, "video/mp4", cleanup, nil
	}

	cleanup()
	return "", "", nil, errors.Join(errs...)
}

func wechatRemoteVideoTranscodeCandidates() []wechatRemoteVideoTranscodeCandidate {
	candidates := make([]wechatRemoteVideoTranscodeCandidate, 0, 4)

	if transcoderPath := strings.TrimSpace(firstNonEmpty(
		os.Getenv("CODEX_WECHAT_VIDEO_TRANSCODER"),
		os.Getenv("CODEX_WECHAT_REMOTE_VIDEO_TRANSCODER"),
	)); transcoderPath != "" {
		candidates = append(candidates, wechatRemoteVideoTranscodeCandidate{
			label:   "custom remote video transcoder",
			command: transcoderPath,
			args: func(inputURL string, outputPath string) []string {
				return []string{inputURL, outputPath}
			},
		})
	}

	ffmpegCommand := strings.TrimSpace(firstNonEmpty(os.Getenv("CODEX_WECHAT_FFMPEG"), "ffmpeg"))
	candidates = append(candidates,
		wechatRemoteVideoTranscodeCandidate{
			label:   "ffmpeg stream copy",
			command: ffmpegCommand,
			args: func(inputURL string, outputPath string) []string {
				return []string{
					"-y",
					"-nostdin",
					"-loglevel", "error",
					"-i", inputURL,
					"-c", "copy",
					"-movflags", "+faststart",
					outputPath,
				}
			},
		},
		wechatRemoteVideoTranscodeCandidate{
			label:   "ffmpeg re-encode",
			command: ffmpegCommand,
			args: func(inputURL string, outputPath string) []string {
				return []string{
					"-y",
					"-nostdin",
					"-loglevel", "error",
					"-i", inputURL,
					"-movflags", "+faststart",
					"-c:v", "libx264",
					"-preset", "veryfast",
					"-crf", "23",
					"-c:a", "aac",
					"-b:a", "128k",
					outputPath,
				}
			},
		},
	)

	return candidates
}

func allocateWeChatRemoteVideoOutputPath(fileNameHint string) (string, func(), error) {
	dir := filepath.Join(os.TempDir(), "codex-server", "wechat", "media", "outbound")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", nil, fmt.Errorf("create wechat media temp dir: %w", err)
	}

	prefix := strings.TrimSuffix(filepath.Base(strings.TrimSpace(fileNameHint)), filepath.Ext(strings.TrimSpace(fileNameHint)))
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		prefix = "wechat-video"
	}
	prefix = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9':
			return r
		case r == '-', r == '_':
			return r
		default:
			return '-'
		}
	}, prefix)

	handle, err := os.CreateTemp(dir, prefix+"-*.mp4")
	if err != nil {
		return "", nil, fmt.Errorf("create wechat remote video temp file: %w", err)
	}
	filePath := handle.Name()
	if closeErr := handle.Close(); closeErr != nil {
		_ = os.Remove(filePath)
		return "", nil, fmt.Errorf("close wechat remote video temp file: %w", closeErr)
	}

	cleanup := func() {
		_ = os.Remove(filePath)
	}
	return filePath, cleanup, nil
}

func runWeChatRemoteVideoTranscodeCandidate(
	ctx context.Context,
	candidate wechatRemoteVideoTranscodeCandidate,
	inputURL string,
	outputPath string,
) error {
	commandPath, err := lookPathWeChatVideoCommand(candidate.command)
	if err != nil {
		return fmt.Errorf("%s was not found: %w", candidateLabel(candidate), err)
	}

	_ = os.Remove(outputPath)
	command := execWeChatVideoCommand(ctx, commandPath, candidate.args(inputURL, outputPath)...)
	output, err := command.CombinedOutput()
	if err != nil {
		_ = os.Remove(outputPath)
		return fmt.Errorf("%s failed: %w: %s", candidateLabel(candidate), err, compactWeChatVideoCommandOutput(output))
	}

	info, statErr := os.Stat(outputPath)
	if statErr != nil {
		return fmt.Errorf("%s did not produce %q: %w", candidateLabel(candidate), outputPath, statErr)
	}
	if info.Size() == 0 {
		_ = os.Remove(outputPath)
		return fmt.Errorf("%s produced an empty mp4 file", candidateLabel(candidate))
	}
	return nil
}

func candidateLabel(candidate wechatRemoteVideoTranscodeCandidate) string {
	if label := strings.TrimSpace(candidate.label); label != "" {
		return label
	}
	return strings.TrimSpace(candidate.command)
}

func compactWeChatVideoCommandOutput(output []byte) string {
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
