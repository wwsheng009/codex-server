package servercmd

import "testing"

func TestApplyServerAddressOptions(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name    string
		base    string
		options serverAddressOptions
		want    string
	}{
		{
			name:    "port preserves empty host",
			base:    ":18080",
			options: serverAddressOptions{Port: "19999"},
			want:    ":19999",
		},
		{
			name:    "port preserves configured host",
			base:    "127.0.0.1:18080",
			options: serverAddressOptions{Port: "19999"},
			want:    "127.0.0.1:19999",
		},
		{
			name:    "host preserves configured port",
			base:    ":18080",
			options: serverAddressOptions{Host: "127.0.0.1"},
			want:    "127.0.0.1:18080",
		},
		{
			name:    "addr replaces base",
			base:    "0.0.0.0:18080",
			options: serverAddressOptions{Addr: "localhost:19999"},
			want:    "localhost:19999",
		},
		{
			name:    "host and port refine addr",
			base:    "0.0.0.0:18080",
			options: serverAddressOptions{Addr: ":19000", Host: "127.0.0.1", Port: "19999"},
			want:    "127.0.0.1:19999",
		},
		{
			name:    "ipv6 host is bracketed",
			base:    ":18080",
			options: serverAddressOptions{Host: "::1", Port: "19999"},
			want:    "[::1]:19999",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := applyServerAddressOptions(tc.base, tc.options)
			if err != nil {
				t.Fatalf("applyServerAddressOptions() error = %v", err)
			}
			if got != tc.want {
				t.Fatalf("applyServerAddressOptions() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestApplyServerAddressOptionsRejectsInvalidValues(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name    string
		options serverAddressOptions
	}{
		{
			name:    "zero port",
			options: serverAddressOptions{Port: "0"},
		},
		{
			name:    "non numeric port",
			options: serverAddressOptions{Port: "abc"},
		},
		{
			name:    "host with scheme",
			options: serverAddressOptions{Host: "http://localhost"},
		},
		{
			name:    "address without port",
			options: serverAddressOptions{Addr: "localhost"},
		},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if _, err := applyServerAddressOptions(":18080", tc.options); err == nil {
				t.Fatal("applyServerAddressOptions() error = nil, want error")
			}
		})
	}
}
