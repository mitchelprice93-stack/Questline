// Number formatting helpers used across XP / progress displays.
//
// formatXp keeps full digits with thousand-separators up to 999,999 so
// small numbers stay legible ("12,345 XP"), then abbreviates once the
// value crosses one million. The same helper is used for both the
// "earned this completion" line and the cumulative running totals so
// readouts stay consistent across the app.

/** Abbreviate `n` against the given scale, picking enough decimal digits to
 *  fit roughly two significant figures. Examples: 1_500_000 / 1_000_000
 *  -> "1.5M"; 12_000_000 / 1_000_000 -> "12M"; -3_400_000 -> "-3.4M". */
function abbreviate(n: number, scale: number, suffix: string): string {
  const v = n / scale;
  // Drop the decimal once the integer part is double-digit or more, to
  // keep the label compact. "1.5M" reads cleanly; "12.3M" feels cluttered.
  const digits = Math.abs(v) >= 10 ? 0 : 1;
  // toFixed always keeps trailing zero ("3.0M"), strip it so we get "3M".
  return `${v.toFixed(digits).replace(/\.0$/, '')}${suffix}`;
}

/**
 * Format an XP value for display. Below one million the number is shown
 * with thousand-separators ("123,456 XP"). At and above one million we
 * abbreviate to keep the readout from overflowing tight UI rows like the
 * level progress line. Negative values (rare, debuff math) are also
 * abbreviated when large.
 */
export function formatXp(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1_000_000) return n.toLocaleString();
  if (abs < 1_000_000_000) return abbreviate(n, 1_000_000, 'M');
  if (abs < 1_000_000_000_000) return abbreviate(n, 1_000_000_000, 'B');
  if (abs < 1_000_000_000_000_000) return abbreviate(n, 1_000_000_000_000, 'T');
  return abbreviate(n, 1_000_000_000_000_000, 'Q');
}
