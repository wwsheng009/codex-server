package servercmd

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"codex-server/backend/internal/accesscontrol"
	"codex-server/backend/internal/store"
)

const defaultStorePath = "data/metadata.json"

type accessTokenAddOptions struct {
	Label     string
	TTL       string
	ExpiresAt string
	StorePath string
	JSON      bool
	Quiet     bool
}

type accessTokenAddResult struct {
	ID            string     `json:"id"`
	Label         string     `json:"label,omitempty"`
	Token         string     `json:"token"`
	Preview       string     `json:"preview"`
	ExpiresAt     *time.Time `json:"expiresAt,omitempty"`
	Permanent     bool       `json:"permanent"`
	StorePath     string     `json:"storePath"`
	LoginEndpoint string     `json:"loginEndpoint"`
}

var openPersistentStoreFunc = store.NewPersistentStore

func parseAccessTokenAddArgs(args []string) (accessTokenAddOptions, error) {
	var options accessTokenAddOptions

	flags := flag.NewFlagSet("access-token add", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.Label, "label", "", "optional token label")
	flags.StringVar(&options.TTL, "ttl", "", "optional token TTL, for example 24h")
	flags.StringVar(&options.ExpiresAt, "expires-at", "", "optional RFC3339 expiry time")
	flags.StringVar(&options.StorePath, "store-path", "", "optional metadata store path override")
	flags.BoolVar(&options.JSON, "json", false, "write JSON output")
	flags.BoolVar(&options.Quiet, "quiet", false, "write only the raw token")

	if err := flags.Parse(args); err != nil {
		return accessTokenAddOptions{}, err
	}
	if flags.NArg() > 0 {
		return accessTokenAddOptions{}, fmt.Errorf("access-token add does not accept positional arguments")
	}

	options.Label = strings.TrimSpace(options.Label)
	options.TTL = strings.TrimSpace(options.TTL)
	options.ExpiresAt = strings.TrimSpace(options.ExpiresAt)
	options.StorePath = strings.TrimSpace(options.StorePath)

	if options.TTL != "" && options.ExpiresAt != "" {
		return accessTokenAddOptions{}, fmt.Errorf("access-token add accepts either --ttl or --expires-at, not both")
	}
	if options.JSON && options.Quiet {
		return accessTokenAddOptions{}, fmt.Errorf("access-token add accepts either --json or --quiet, not both")
	}

	return options, nil
}

func addAccessToken(options accessTokenAddOptions, stdout io.Writer) error {
	storePath := accessTokenStorePathFromEnv(options.StorePath)
	dataStore, err := openPersistentStoreFunc(storePath)
	if err != nil {
		return err
	}
	defer func() {
		_ = dataStore.Close()
	}()

	now := time.Now().UTC()
	rawToken, err := generateAccessTokenValue()
	if err != nil {
		return fmt.Errorf("generate access token: %w", err)
	}
	expiresAt, err := resolveAccessTokenExpiry(options, now)
	if err != nil {
		return err
	}

	prefs := dataStore.GetRuntimePreferences()
	newInput := accesscontrol.TokenInput{
		Label: options.Label,
		Token: rawToken,
	}
	if expiresAt == nil {
		newInput.Permanent = true
	} else {
		newInput.ExpiresAt = expiresAt.Format(time.RFC3339)
	}

	normalizedExisting, err := accesscontrol.NormalizeConfiguredTokens(prefs.AccessTokens, now)
	if err != nil {
		return err
	}
	createdTokens, err := accesscontrol.ApplyTokenInputs(nil, []accesscontrol.TokenInput{newInput}, now)
	if err != nil {
		return err
	}
	if len(createdTokens) == 0 {
		return fmt.Errorf("access token was not created")
	}

	createdToken := createdTokens[0]
	nextTokens := append(append([]store.AccessToken(nil), normalizedExisting...), createdToken)
	if _, err := accesscontrol.NormalizeConfiguredTokens(nextTokens, now); err != nil {
		return err
	}

	prefs.AccessTokens = nextTokens
	dataStore.SetRuntimePreferences(prefs)

	resolvedStorePath, pathErr := filepath.Abs(storePath)
	if pathErr != nil {
		resolvedStorePath = storePath
	}

	result := accessTokenAddResult{
		ID:            createdToken.ID,
		Label:         createdToken.Label,
		Token:         rawToken,
		Preview:       createdToken.TokenPreview,
		ExpiresAt:     cloneOptionalAccessTokenTime(createdToken.ExpiresAt),
		Permanent:     createdToken.ExpiresAt == nil,
		StorePath:     resolvedStorePath,
		LoginEndpoint: "/api/access/login",
	}
	if err := writeAccessTokenAddResult(stdout, result, options); err != nil {
		return err
	}

	return nil
}

func resolveAccessTokenExpiry(options accessTokenAddOptions, now time.Time) (*time.Time, error) {
	if options.TTL != "" {
		duration, err := time.ParseDuration(options.TTL)
		if err != nil {
			return nil, fmt.Errorf("invalid --ttl value: %w", err)
		}
		if duration <= 0 {
			return nil, fmt.Errorf("--ttl must be greater than zero")
		}
		expiresAt := now.Add(duration).UTC()
		return &expiresAt, nil
	}

	if options.ExpiresAt == "" {
		return nil, nil
	}

	expiresAt, err := time.Parse(time.RFC3339, options.ExpiresAt)
	if err != nil {
		return nil, fmt.Errorf("invalid --expires-at value: must use RFC3339")
	}
	expiresAt = expiresAt.UTC()
	if !expiresAt.After(now) {
		return nil, fmt.Errorf("--expires-at must be in the future")
	}
	return &expiresAt, nil
}

func generateAccessTokenValue() (string, error) {
	buffer := make([]byte, 24)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return "cxs_" + base64.RawURLEncoding.EncodeToString(buffer), nil
}

func accessTokenStorePathFromEnv(explicitPath string) string {
	if strings.TrimSpace(explicitPath) != "" {
		return strings.TrimSpace(explicitPath)
	}

	storePath := strings.TrimSpace(os.Getenv("CODEX_SERVER_STORE_PATH"))
	if storePath == "" {
		return defaultStorePath
	}
	return storePath
}

func writeAccessTokenAddResult(stdout io.Writer, result accessTokenAddResult, options accessTokenAddOptions) error {
	switch {
	case options.Quiet:
		_, err := fmt.Fprintln(stdout, result.Token)
		return err
	case options.JSON:
		encoder := json.NewEncoder(stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(result)
	default:
		fmt.Fprintln(stdout, "access token added")
		fmt.Fprintf(stdout, "id: %s\n", result.ID)
		if result.Label != "" {
			fmt.Fprintf(stdout, "label: %s\n", result.Label)
		}
		fmt.Fprintf(stdout, "token: %s\n", result.Token)
		fmt.Fprintf(stdout, "preview: %s\n", result.Preview)
		if result.Permanent || result.ExpiresAt == nil {
			fmt.Fprintln(stdout, "expiresAt: permanent")
		} else {
			fmt.Fprintf(stdout, "expiresAt: %s\n", result.ExpiresAt.UTC().Format(time.RFC3339))
		}
		fmt.Fprintf(stdout, "storePath: %s\n", result.StorePath)
		fmt.Fprintf(stdout, "login: POST %s with {\"token\":\"<token>\"}\n", result.LoginEndpoint)
		return nil
	}
}

func cloneOptionalAccessTokenTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}

	cloned := value.UTC()
	return &cloned
}
