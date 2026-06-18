import { xirr } from "./xirr.js";

export type FundingSource = "dbs" | "bonus" | "proceeds" | "unspecified";
export type Side = "buy" | "sell";

export type TransactionRow = {
  id: string;
  occurred_at: string;
  side: Side;
  ticker: string;
  name: string | null;
  quantity: number;
  price_usd: number;
  fx_sgd_per_usd: number;
  funding_source: FundingSource;
  fees_usd: number;
  notes: string | null;
};

export type Position = {
  ticker: string;
  name: string | null;
  shares: number;
  costBasisUsd: number;
  avgCostUsd: number;
  marketPriceUsd: number | null;
  marketValueUsd: number;
  marketValueSgd: number;
  pctOfPortfolio: number;
  xirr: number | null;
  weightedXirrContribution: number;
};

export type CapitalOverview = {
  dbsCapitalDeployedUsd: number;
  dbsCapitalDeployedSgd: number;
  bonusCapitalDeployedUsd: number;
  bonusCapitalDeployedSgd: number;
  recoveredCapitalFromSalesUsd: number;
  recoveredCapitalFromSalesSgd: number;
  totalRecycledCapitalUsd: number;
  totalRecycledCapitalSgd: number;
  totalUnrecycledCapitalUsd: number;
  totalUnrecycledCapitalSgd: number;
  totalInvestedCapitalUsd: number;
  totalInvestedCapitalSgd: number;
  currentPortfolioValueUsd: number;
  currentPortfolioValueSgd: number;
  netGainLossUsd: number;
  netGainLossSgd: number;
  portfolioXirr: number | null;
  /** Arithmetic mean of open positions’ XIRR (equal weight per holding); null if none computable. */
  averageHoldingXirr: number | null;
  fxSgdPerUsdLatest: number;
};

function buyCashOutUsd(q: number, price: number, fees: number): number {
  return q * price + fees;
}

function sellCashInUsd(q: number, price: number, fees: number): number {
  return q * price - fees;
}

function toSgd(usd: number, fx: number): number {
  return usd * fx;
}

export function buildPortfolio(
  rows: TransactionRow[],
  prices: Record<string, number | null>,
  asOf: Date = new Date()
): { positions: Position[]; capital: CapitalOverview; transactions: TransactionRow[] } {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );

  type LotState = {
    ticker: string;
    name: string | null;
    shares: number;
    costBasisUsd: number;
  };

  const byTicker = new Map<string, LotState>();
  const portfolioFlows: { date: Date; amount: number }[] = [];

  let dbsUsd = 0;
  let dbsSgd = 0;
  let bonusUsd = 0;
  let bonusSgd = 0;
  let recoveredUsd = 0;
  let recoveredSgd = 0;
  let recycledUsd = 0;
  let recycledSgd = 0;

  let latestFx = 1.35;
  if (sorted.length) {
    latestFx = sorted[sorted.length - 1].fx_sgd_per_usd;
  }

  for (const tx of sorted) {
    const d = new Date(tx.occurred_at);
    const t = tx.ticker.trim().toUpperCase();
    const fx = tx.fx_sgd_per_usd;
    latestFx = fx;

    if (tx.side === "buy") {
      const outUsd = buyCashOutUsd(tx.quantity, tx.price_usd, tx.fees_usd);
      portfolioFlows.push({ date: d, amount: -outUsd });

      if (tx.funding_source === "dbs") {
        dbsUsd += outUsd;
        dbsSgd += toSgd(outUsd, fx);
      } else if (tx.funding_source === "bonus") {
        bonusUsd += outUsd;
        bonusSgd += toSgd(outUsd, fx);
      } else if (tx.funding_source === "proceeds") {
        recycledUsd += outUsd;
        recycledSgd += toSgd(outUsd, fx);
      }

      let st = byTicker.get(t);
      if (!st) {
        st = { ticker: t, name: tx.name, shares: 0, costBasisUsd: 0 };
        byTicker.set(t, st);
      }
      if (tx.name) st.name = tx.name;
      st.shares += tx.quantity;
      st.costBasisUsd += outUsd;
    } else {
      const inUsd = sellCashInUsd(tx.quantity, tx.price_usd, tx.fees_usd);
      portfolioFlows.push({ date: d, amount: inUsd });
      recoveredUsd += inUsd;
      recoveredSgd += toSgd(inUsd, fx);

      const st = byTicker.get(t);
      if (!st || st.shares <= 0) continue;
      const sellQty = Math.min(tx.quantity, st.shares);
      const avg = st.costBasisUsd / st.shares;
      st.costBasisUsd -= avg * sellQty;
      st.shares -= sellQty;
      if (st.shares < 1e-9) {
        st.shares = 0;
        st.costBasisUsd = 0;
      }
    }
  }

  const unrecycledUsd = Math.max(0, recoveredUsd - recycledUsd);
  const unrecycledSgd = Math.max(0, recoveredSgd - recycledSgd);

  const positionsRaw: LotState[] = [...byTicker.values()].filter((s) => s.shares > 0);

  let totalMvUsd = 0;
  const positions: Position[] = [];

  for (const st of positionsRaw) {
    const px = prices[st.ticker] ?? null;
    const mvUsd = px != null ? st.shares * px : 0;
    totalMvUsd += mvUsd;
  }

  for (const st of positionsRaw) {
    const px = prices[st.ticker] ?? null;
    const mvUsd = px != null ? st.shares * px : 0;
    const mvSgd = mvUsd * latestFx;
    const avgCost = st.shares > 0 ? st.costBasisUsd / st.shares : 0;
    const pct = totalMvUsd > 0 && px != null ? mvUsd / totalMvUsd : 0;

    const tickerFlows: { date: Date; amount: number }[] = [];
    for (const tx of sorted) {
      const t = tx.ticker.trim().toUpperCase();
      if (t !== st.ticker) continue;
      const d = new Date(tx.occurred_at);
      if (tx.side === "buy") {
        tickerFlows.push({ date: d, amount: -buyCashOutUsd(tx.quantity, tx.price_usd, tx.fees_usd) });
      } else {
        tickerFlows.push({ date: d, amount: sellCashInUsd(tx.quantity, tx.price_usd, tx.fees_usd) });
      }
    }
    if (px != null && st.shares > 0) {
      tickerFlows.push({ date: asOf, amount: st.shares * px });
    }
    const posXirr = xirr(tickerFlows);

    positions.push({
      ticker: st.ticker,
      name: st.name,
      shares: st.shares,
      costBasisUsd: st.costBasisUsd,
      avgCostUsd: avgCost,
      marketPriceUsd: px,
      marketValueUsd: mvUsd,
      marketValueSgd: mvSgd,
      pctOfPortfolio: pct,
      xirr: posXirr,
      weightedXirrContribution: posXirr != null ? pct * posXirr : 0,
    });
  }

  positions.sort((a, b) => b.marketValueUsd - a.marketValueUsd);

  const investedUsd = positions.reduce((s, p) => s + p.costBasisUsd, 0);
  const investedSgd = positions.reduce((s, p) => s + p.costBasisUsd * latestFx, 0);

  if (totalMvUsd > 0) {
    portfolioFlows.push({ date: asOf, amount: totalMvUsd });
  }
  const portXirr = xirr(portfolioFlows);

  const totalMvSgd = totalMvUsd * latestFx;

  const xirrValues = positions
    .map((p) => p.xirr)
    .filter((x): x is number => x != null && Number.isFinite(x));
  const averageHoldingXirr =
    xirrValues.length > 0 ? xirrValues.reduce((a, b) => a + b, 0) / xirrValues.length : null;

  const capital: CapitalOverview = {
    dbsCapitalDeployedUsd: dbsUsd,
    dbsCapitalDeployedSgd: dbsSgd,
    bonusCapitalDeployedUsd: bonusUsd,
    bonusCapitalDeployedSgd: bonusSgd,
    recoveredCapitalFromSalesUsd: recoveredUsd,
    recoveredCapitalFromSalesSgd: recoveredSgd,
    totalRecycledCapitalUsd: recycledUsd,
    totalRecycledCapitalSgd: recycledSgd,
    totalUnrecycledCapitalUsd: unrecycledUsd,
    totalUnrecycledCapitalSgd: unrecycledSgd,
    totalInvestedCapitalUsd: investedUsd,
    totalInvestedCapitalSgd: investedSgd,
    currentPortfolioValueUsd: totalMvUsd,
    currentPortfolioValueSgd: totalMvSgd,
    netGainLossUsd: totalMvUsd - investedUsd,
    netGainLossSgd: totalMvSgd - investedSgd,
    portfolioXirr: portXirr,
    averageHoldingXirr,
    fxSgdPerUsdLatest: latestFx,
  };

  return { positions, capital, transactions: sorted };
}
