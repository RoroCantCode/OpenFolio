type YahooChart = {
  chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
};

const UA = {
  "User-Agent": "OpenFolio/1.0",
  Accept: "application/json",
} as const;

/** Approximate 2-week total return from daily closes (first vs last bar in window). */
export async function fetchTwoWeekReturnPct(ticker: string): Promise<number | null> {
  const sym = ticker.trim().toUpperCase().replace(/\./g, "-");
  if (!sym) return null;
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 14 * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${period1}&period2=${now}&interval=1d`;
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return null;
    const json = (await res.json()) as YahooChart;
    const r = json.chart?.result?.[0];
    const closes = r?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(closes)) return null;
    const nums = closes.filter((x): x is number => x != null && Number.isFinite(x));
    if (nums.length < 2) return null;
    const first = nums[0];
    const last = nums[nums.length - 1];
    if (first === 0) return null;
    return (last - first) / first;
  } catch {
    return null;
  }
}
