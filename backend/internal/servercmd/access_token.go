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
	"text/tabwriter"
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

type accessTokenListOptions struct {
	StorePath string
	JSON      bool
}

type accessTokenDeleteOptions struct {
	ID        string
	StorePath string
	JSON      bool
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

type accessTokenListEntry struct {
	ID        string     `json:"id"`
	Label     string     `json:"label,omitempty"`
	Preview   string     `json:"preview,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	Permanent bool       `json:"permanent"`
	Status    string     `json:"status"`
	Valid     bool       `json:"valid"`
	CreatedAt time.Time  `json:"createdAt,omitempty"`
	UpdatedAt time.Time  `json:"updatedAt,omitempty"`
}

type accessTokenListResult struct {
	Count      int                    `json:"count"`
	ValidCount int                    `json:"validCount"`
	StorePath  string                 `json:"storePath"`
	Tokens     []accessTokenListEntry `json:"tokens"`
}

type accessTokenDeleteResult struct {
	ID             string     `json:"id"`
	Label          string     `json:"label,omitempty"`
	Preview        string     `json:"preview,omitempty"`
	ExpiresAt      *time.Time `json:"expiresAt,omitempty"`
	Permanent      bool       `json:"permanent"`
	Status         string     `json:"status"`
	Valid          bool       `json:"valid"`
	RemainingCount int        `json:"remainingCount"`
	StorePath      string     `json:"storePath"`
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

func parseAccessTokenListArgs(args []string) (accessTokenListOptions, error) {
	var options accessTokenListOptions

	flags := flag.NewFlagSet("access-token list", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.StorePath, "store-path", "", "optional metadata store path override")
	flags.BoolVar(&options.JSON, "json", false, "write JSON output")

	if err := flags.Parse(args); err != nil {
		return accessTokenListOptions{}, err
	}
	if flags.NArg() > 0 {
		return accessTokenListOptions{}, fmt.Errorf("access-token list does not accept positional arguments")
	}

	options.StorePath = strings.TrimSpace(options.StorePath)
	return options, nil
}

func parseAccessTokenDeleteArgs(args []string) (accessTokenDeleteOptions, error) {
	var options accessTokenDeleteOptions
	positional := make([]string, 0, 1)
	for index := 0; index < len(args); index++ {
		arg := strings.TrimSpace(args[index])
		switch {
		case arg == "":
			continue
		case arg == "--json":
			options.JSON = true
		case arg == "--store-path":
			index++
			if index >= len(args) {
				return accessTokenDeleteOptions{}, fmt.Errorf("access-token delete requires a value for --store-path")
			}
			options.StorePath = strings.TrimSpace(args[index])
		case strings.HasPrefix(arg, "--store-path="):
			options.StorePath = strings.TrimSpace(strings.TrimPrefix(arg, "--store-path="))
		case strings.HasPrefix(arg, "-"):
			return accessTokenDeleteOptions{}, fmt.Errorf("access-token delete does not recognize %q", arg)
		default:
			positional = append(positional, arg)
		}
	}
	if len(positional) != 1 {
		return accessTokenDeleteOptions{}, fmt.Errorf("access-token delete requires exactly 1 token id")
	}

	options.ID = strings.TrimSpace(positional[0])
	options.StorePath = strings.TrimSpace(options.StorePath)
	if options.ID == "" {
		return accessTokenDeleteOptions{}, fmt.Errorf("access-token delete requires a non-empty token id")
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
	nextInputs := append(existingAccessTokenInputs(normalizedExisting), newInput)
	nextTokens, err := accesscontrol.ApplyTokenInputs(normalizedExisting, nextInputs, now)
	if err != nil {
		return err
	}
	if len(nextTokens) <= len(normalizedExisting) {
		return fmt.Errorf("access token was not created")
	}

	createdToken := nextTokens[len(nextTokens)-1]
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

func listAccessTokens(options accessTokenListOptions, stdout io.Writer) error {
	storePath := accessTokenStorePathFromEnv(options.StorePath)
	dataStore, err := openPersistentStoreFunc(storePath)
	if err != nil {
		return err
	}
	defer func() {
		_ = dataStore.Close()
	}()

	now := time.Now().UTC()
	prefs := dataStore.GetRuntimePreferences()
	normalizedTokens, err := accesscontrol.NormalizeConfiguredTokens(prefs.AccessTokens, now)
	if err != nil {
		return err
	}

	resolvedStorePath, pathErr := filepath.Abs(storePath)
	if pathErr != nil {
		resolvedStorePath = storePath
	}

	descriptors := accesscontrol.DescribeTokens(normalizedTokens, now)
	result := accessTokenListResult{
		Count:      len(descriptors),
		ValidCount: accesscontrol.CountActiveTokens(normalizedTokens, now),
		StorePath:  resolvedStorePath,
		Tokens:     make([]accessTokenListEntry, 0, len(descriptors)),
	}
	for _, descriptor := range descriptors {
		result.Tokens = append(result.Tokens, accessTokenListEntry{
			ID:        descriptor.ID,
			Label:     descriptor.Label,
			Preview:   descriptor.TokenPreview,
			ExpiresAt: cloneOptionalAccessTokenTime(descriptor.ExpiresAt),
			Permanent: descriptor.Permanent,
			Status:    descriptor.Status,
			Valid:     descriptor.Status == "active",
			CreatedAt: descriptor.CreatedAt,
			UpdatedAt: descriptor.UpdatedAt,
		})
	}

	return writeAccessTokenListResult(stdout, result, options)
}

func deleteAccessToken(options accessTokenDeleteOptions, stdout io.Writer) error {
	storePath := accessTokenStorePathFromEnv(options.StorePath)
	dataStore, err := openPersistentStoreFunc(storePath)
	if err != nil {
		return err
	}
	defer func() {
		_ = dataStore.Close()
	}()

	now := time.Now().UTC()
	prefs := dataStore.GetRuntimePreferences()
	normalizedTokens, err := accesscontrol.NormalizeConfiguredTokens(prefs.AccessTokens, now)
	if err != nil {
		return err
	}

	var deleted store.AccessToken
	nextTokens := make([]store.AccessToken, 0, max(len(normalizedTokens)-1, 0))
	found := false
	for _, token := range normalizedTokens {
		if token.ID == options.ID {
			deleted = token
			found = true
			continue
		}
		nextTokens = append(nextTokens, token)
	}
	if !found {
		return fmt.Errorf("access token %q was not found", options.ID)
	}

	prefs.AccessTokens = nextTokens
	dataStore.SetRuntimePreferences(prefs)

	resolvedStorePath, pathErr := filepath.Abs(storePath)
	if pathErr != nil {
		resolvedStorePath = storePath
	}

	status := accessTokenStatus(deleted, now)
	result := accessTokenDeleteResult{
		ID:             deleted.ID,
		Label:          deleted.Label,
		Preview:        deleted.TokenPreview,
		ExpiresAt:      cloneOptionalAccessTokenTime(deleted.ExpiresAt),
		Permanent:      deleted.ExpiresAt == nil,
		Status:         status,
		Valid:          status == "active",
		RemainingCount: len(nextTokens),
		StorePath:      resolvedStorePath,
	}

	return writeAccessTokenDeleteResult(stdout, result, options)
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

func existingAccessTokenInputs(tokens []store.AccessToken) []accesscontrol.TokenInput {
	if len(tokens) == 0 {
		return nil
	}

	inputs := make([]accesscontrol.TokenInput, 0, len(tokens))
	for _, token := range tokens {
		input := accesscontrol.TokenInput{
			ID:    token.ID,
			Label: token.Label,
		}
		if token.ExpiresAt == nil {
			input.Permanent = true
		} else {
			input.ExpiresAt = token.ExpiresAt.UTC().Format(time.RFC3339)
		}
		inputs = append(inputs, input)
	}
	return inputs
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

func writeAccessTokenListResult(stdout io.Writer, result accessTokenListResult, options accessTokenListOptions) error {
	if options.JSON {
		encoder := json.NewEncoder(stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(result)
	}

	if result.Count == 0 {
		fmt.Fprintln(stdout, "no access tokens configured")
		fmt.Fprintf(stdout, "storePath: %s\n", result.StorePath)
		return nil
	}

	fmt.Fprintln(stdout, "access tokens")
	fmt.Fprintf(stdout, "count: %d\n", result.Count)
	fmt.Fprintf(stdout, "valid: %d\n", result.ValidCount)
	fmt.Fprintf(stdout, "storePath: %s\n", result.StorePath)

	writer := tabwriter.NewWriter(stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(writer, "ID\tLABEL\tPREVIEW\tVALID\tSTATUS\tEXPIRES AT")
	for _, token := range result.Tokens {
		label := token.Label
		if label == "" {
			label = "-"
		}
		preview := token.Preview
		if preview == "" {
			preview = "-"
		}
		expiresAt := "permanent"
		if token.ExpiresAt != nil {
			expiresAt = token.ExpiresAt.UTC().Format(time.RFC3339)
		}

		fmt.Fprintf(
			writer,
			"%s\t%s\t%s\t%s\t%s\t%s\n",
			token.ID,
			label,
			preview,
			boolText(token.Valid),
			token.Status,
			expiresAt,
		)
	}
	return writer.Flush()
}

func writeAccessTokenDeleteResult(stdout io.Writer, result accessTokenDeleteResult, options accessTokenDeleteOptions) error {
	if options.JSON {
		encoder := json.NewEncoder(stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(result)
	}

	fmt.Fprintln(stdout, "access token deleted")
	fmt.Fprintf(stdout, "id: %s\n", result.ID)
	if result.Label != "" {
		fmt.Fprintf(stdout, "label: %s\n", result.Label)
	}
	if result.Preview != "" {
		fmt.Fprintf(stdout, "preview: %s\n", result.Preview)
	}
	fmt.Fprintf(stdout, "valid: %s\n", boolText(result.Valid))
	fmt.Fprintf(stdout, "status: %s\n", result.Status)
	if result.Permanent || result.ExpiresAt == nil {
		fmt.Fprintln(stdout, "expiresAt: permanent")
	} else {
		fmt.Fprintf(stdout, "expiresAt: %s\n", result.ExpiresAt.UTC().Format(time.RFC3339))
	}
	fmt.Fprintf(stdout, "remaining: %d\n", result.RemainingCount)
	fmt.Fprintf(stdout, "storePath: %s\n", result.StorePath)
	return nil
}

func boolText(value bool) string {
	if value {
		return "yes"
	}
	return "no"
}

func accessTokenStatus(token store.AccessToken, now time.Time) string {
	descriptors := accesscontrol.DescribeTokens([]store.AccessToken{token}, now)
	if len(descriptors) == 0 {
		return ""
	}
	return descriptors[0].Status
}

func cloneOptionalAccessTokenTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}

	cloned := value.UTC()
	return &cloned
}
