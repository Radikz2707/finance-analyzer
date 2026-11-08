/** Provider fallback helper stub */
export async function withProviderFallback<T>(
  fn: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fallback();
  }
}
