import type { Settings } from '../core/types';

export type DisplayUnits = Settings['units'];

/** Display conversions. All calculations stay in SI (°C, kW). */
export const conv = (u: DisplayUnits) => {
  const pScale = u.power === 'MW' ? 1000 : 1;
  return {
    tUnit: u.temperature === 'K' ? 'K' : '°C',
    pUnit: u.power,
    cpUnit: `${u.power}/K`,
    /** absolute temperature to display */
    t: (x: number) => (u.temperature === 'K' ? x + 273.15 : x),
    tIn: (x: number) => (u.temperature === 'K' ? x - 273.15 : x),
    /** power / enthalpy / CP to display */
    p: (x: number) => x / pScale,
    pIn: (x: number) => x * pScale,
  };
};

export type Conv = ReturnType<typeof conv>;

/** Format a number for tables: blank-safe, adaptive decimals. */
export function num(x: number | null | undefined, dp?: number): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
  const a = Math.abs(x);
  const d = dp ?? (a === 0 ? 0 : a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 3);
  const s = x.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: d });
  return s === '-0' ? '0' : s.replace('-', '−');
}

export function money(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const s = Math.round(x).toLocaleString('en');
  return x < 0 ? `−$${s.slice(1)}` : `$${s}`;
}

/** Nice axis ticks covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, target = 6): { ticks: number[]; lo: number; hi: number } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ticks: [0, 1], lo: 0, hi: 1 };
  if (hi - lo < 1e-12) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { ticks, lo: start, hi: end };
}
