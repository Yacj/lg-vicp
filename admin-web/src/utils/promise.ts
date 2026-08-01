export async function asyncHandler<T>(
  promise: Promise<T>,
  timeout?: number,
): Promise<[T | null, Error | null]> {
  try {
    const result = timeout
      ? await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error('Timeout')), timeout)
          }),
        ])
      : await promise

    return [result, null]
  }
  catch (error) {
    return [null, error instanceof Error ? error : new Error(String(error))]
  }
}
