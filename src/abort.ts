export function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Operation aborted')
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

/** Stop waiting for a model/approval even when its adapter ignores the signal. */
export async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  let cancel: (() => void) | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        cancel = () => reject(abortError(signal))
        if (signal.aborted) cancel()
        else signal.addEventListener('abort', cancel, { once: true })
      }),
    ])
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel)
  }
}

export function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, Math.max(0, milliseconds))

    function finish(): void {
      signal?.removeEventListener('abort', cancel)
      resolve()
    }

    function cancel(): void {
      clearTimeout(timer)
      reject(abortError(signal!))
    }

    signal?.addEventListener('abort', cancel, { once: true })
  })
}
