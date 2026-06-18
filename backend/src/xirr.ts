/** XIRR via bisection on annual rate; cashFlow amounts: outflows negative, inflows positive. */
export function xirr(
  cashFlows: { date: Date; amount: number }[],
  options?: { low?: number; high?: number; maxIter?: number }
): number | null {
  if (cashFlows.length < 2) return null;
  const sorted = [...cashFlows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();
  const flows = sorted.map((cf) => ({
    years: (cf.date.getTime() - t0) / (365.25 * 24 * 3600 * 1000),
    amount: cf.amount,
  }));

  const npv = (rate: number) =>
    flows.reduce((acc, f) => acc + f.amount / Math.pow(1 + rate, f.years), 0);

  let low = options?.low ?? -0.9999;
  let high = options?.high ?? 10;
  const maxIter = options?.maxIter ?? 200;

  let npvLow = npv(low);
  let npvHigh = npv(high);
  if (!Number.isFinite(npvLow) || !Number.isFinite(npvHigh)) return null;

  // Expand upper bound if needed
  let expand = 0;
  while (npvLow * npvHigh > 0 && expand < 30) {
    high *= 2;
    npvHigh = npv(high);
    expand++;
  }
  if (npvLow * npvHigh > 0) return null;

  for (let i = 0; i < maxIter; i++) {
    const mid = (low + high) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1e-7) return mid;
    if (v * npvLow > 0) {
      low = mid;
      npvLow = v;
    } else {
      high = mid;
      npvHigh = v;
    }
  }
  return (low + high) / 2;
}
