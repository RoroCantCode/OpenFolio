import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TransactionRow } from "./api";
import { fmtSgd, fmtUsd } from "./format";

export type DisplayCurrency = "USD" | "SGD";

type Ctx = {
  currency: DisplayCurrency;
  setCurrency: (c: DisplayCurrency) => void;
  liveFx: number | null;
  /** Portfolio / positions / charts: convert USD → SGD using today's spot. */
  fmtPortfolioMoney: (usd: number, digits?: number) => string;
  toDisplayFromUsd: (usd: number) => number;
  fmtLedgerPrice: (row: TransactionRow, digits?: number) => string;
  fmtLedgerFees: (row: TransactionRow, digits?: number) => string;
};

const CurrencyContext = createContext<Ctx | null>(null);

export function CurrencyProvider({
  children,
  liveFx,
}: {
  children: ReactNode;
  liveFx: number | null;
}) {
  const [currency, setCurrency] = useState<DisplayCurrency>("USD");

  useEffect(() => {
    if (liveFx == null && currency === "SGD") {
      setCurrency("USD");
    }
  }, [liveFx, currency]);

  const value = useMemo<Ctx>(() => {
    const fx = liveFx ?? 1;
    const toDisplayFromUsd = (usd: number) => (currency === "USD" ? usd : usd * fx);
    const fmtPortfolioMoney = (usd: number, digits = 2) =>
      currency === "USD" ? fmtUsd(usd, digits) : fmtSgd(usd * fx, digits);
    const fmtLedgerPrice = (row: TransactionRow, digits = 2) =>
      currency === "USD" ? fmtUsd(row.price_usd, digits) : fmtSgd(row.price_usd * row.fx_sgd_per_usd, digits);
    const fmtLedgerFees = (row: TransactionRow, digits = 2) =>
      currency === "USD" ? fmtUsd(row.fees_usd, digits) : fmtSgd(row.fees_usd * row.fx_sgd_per_usd, digits);

    return {
      currency,
      setCurrency,
      liveFx,
      fmtPortfolioMoney,
      toDisplayFromUsd,
      fmtLedgerPrice,
      fmtLedgerFees,
    };
  }, [currency, liveFx]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): Ctx {
  const v = useContext(CurrencyContext);
  if (!v) throw new Error("useCurrency must be used within CurrencyProvider");
  return v;
}
