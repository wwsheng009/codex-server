package jobs

import "errors"

type failureOutputProvider interface {
	FailureOutput() map[string]any
}

type failureOutputError struct {
	err    error
	output map[string]any
}

func (e *failureOutputError) Error() string {
	if e == nil || e.err == nil {
		return ""
	}
	return e.err.Error()
}

func (e *failureOutputError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func (e *failureOutputError) FailureOutput() map[string]any {
	if e == nil {
		return nil
	}
	return cloneAnyMap(e.output)
}

func withFailureOutput(err error, output map[string]any) error {
	if err == nil || len(output) == 0 {
		return err
	}
	return &failureOutputError{
		err:    err,
		output: cloneAnyMap(output),
	}
}

func extractFailureOutput(err error) map[string]any {
	var provider failureOutputProvider
	if !errors.As(err, &provider) {
		return nil
	}
	return cloneAnyMap(provider.FailureOutput())
}
