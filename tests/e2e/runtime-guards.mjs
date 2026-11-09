export function createAbortTimeout(lifecycle, timeoutMs) {
  let timerId;
  const promise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      const error = new Error(`E2E workflow timed out after ${timeoutMs} milliseconds`);
      void lifecycle.abort(error).then(
        () => reject(error),
        (abortError) => reject(abortError)
      );
    }, timeoutMs);
  });
  return {
    promise,
    cancel: () => clearTimeout(timerId)
  };
}

export function createSignalAbortHandler(lifecycle, {
  signal,
  exitCode,
  exit = process.exit
}) {
  let handled = false;
  return () => {
    if (handled) return;
    handled = true;
    void lifecycle.abort(new Error(`E2E interrupted by ${signal}`))
      .finally(() => exit(exitCode));
  };
}
