import { Decimal128 } from "mongodb";

export function toDecimal128(n: number): Decimal128 {
  return Decimal128.fromString(String(n));
}

export function fromDecimal128(d: Decimal128 | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return Number(d.toString());
}

export function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

export function toIsoString(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
