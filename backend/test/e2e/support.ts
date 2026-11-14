/** Polls until `read` returns something other than null. For state that settles a moment after the call that caused it. */
export async function eventually<T>(
  read: () => Promise<T | null>,
  { timeoutMs = 30_000, intervalMs = 1000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the expected state");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
