// Presentation only: never round the underlying simulation or network values.
// Scores/rates/speeds keep at most one decimal; ratios may opt into two.
// Fixed-width trailing zeroes and floating-point tails add no useful information.
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function formatNumber(value, digits = 1) {
  return String(Number(finite(value).toFixed(Math.max(0, Math.min(3, digits)))));
}

export const formatWhole = value => formatNumber(value, 0);

// Spendable balances round down so the UI never promises an unaffordable buy.
export const formatResource = value => String(Math.floor(Math.max(0, finite(value))));

// Positive timers must not say zero/ready early. Only the final five seconds
// need sub-second precision; strip .0 there too to keep labels short.
export function formatCountdown(value) {
  const seconds = Math.max(0, finite(value));
  return formatNumber(seconds < 5 ? Math.ceil(seconds * 10) / 10 : Math.ceil(seconds));
}
