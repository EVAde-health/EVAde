/** Tiny helpers that reproduce Python number formatting used in the reason strings. */

/** Round-half-even on exact ties, like Python's round()/format for values that are exact ties. */
function roundTo(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  const scaled = value * 10 ** digits;
  const frac = Math.abs(scaled - Math.trunc(scaled));
  if (frac === 0.5 && Number.isFinite(scaled)) {
    const lower = Math.trunc(scaled);
    const even = lower % 2 === 0 ? lower : lower + Math.sign(scaled);
    return (even / 10 ** digits).toFixed(digits);
  }
  return fixed;
}

/** f"{x:.1f}" */
export function fmtFixed(value: number, digits = 1): string {
  return roundTo(value, digits);
}

/** round(x, 1) */
export function round1(value: number): number {
  return Number(roundTo(value, 1));
}

/** f"{x:g}" (6 significant digits, trailing zeros stripped, exponent outside 1e-4..1e6). */
export function fmtG(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "inf" : value < 0 ? "-inf" : "nan";
  if (value === 0) return Object.is(value, -0) ? "-0" : "0";
  const exp = Math.floor(Math.log10(Math.abs(Number(value.toPrecision(6)))));
  if (exp < -4 || exp >= 6) {
    const [mant, e] = value.toExponential(5).split("e");
    const m = mant.includes(".") ? mant.replace(/0+$/, "").replace(/\.$/, "") : mant;
    const n = Number(e);
    return `${m}e${n < 0 ? "-" : "+"}${String(Math.abs(n)).padStart(2, "0")}`;
  }
  const s = value.toPrecision(6);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}
