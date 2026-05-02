// Helpers for surfacing errors that come from supabase-js (PostgrestError,
// FunctionsHttpError, etc.) — these are plain objects, not Error instances,
// so naive `e instanceof Error ? e.message : String(e)` returns "[object Object]"
// and loses the real failure detail.

export interface MessageBearing {
  message: string;
}

export function isMessageBearing(value: unknown): value is MessageBearing {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  );
}

/**
 * Extract a human-readable message from any thrown value. Handles Error,
 * PostgrestError, FunctionsHttpError, and other shapes that carry a `message`
 * field. Falls back to `String(value)` only when nothing else fits.
 */
export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (isMessageBearing(value)) return value.message;
  return String(value);
}

/**
 * Wrap a supabase-js `error` (or anything else thrown) in a real Error
 * instance, preserving the message. Use at throw sites so callers can rely on
 * `instanceof Error` and `e.message`.
 */
export function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(errorMessage(value));
}
