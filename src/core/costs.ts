import type { CapitalModel, CostParams, Economics } from './types';
import { compileExpression } from './expression';

/** Annualisation factor: i(1+i)^n / ((1+i)^n − 1); 1/n when i = 0. */
export function annualisationFactor(interestRate: number, plantLife: number): number {
  if (!(plantLife > 0)) return 0;
  const i = interestRate;
  if (Math.abs(i) < 1e-12) return 1 / plantLife;
  const g = Math.pow(1 + i, plantLife);
  return (i * g) / (g - 1);
}

export interface CapitalInput {
  area: { total: number; exchanger: number; heater: number; cooler: number };
  units: { total: number; exchanger: number; heater: number; cooler: number };
}

export interface CapitalResult {
  /** Installed capital, $ */
  capital: number;
  /** Annualised capital, $/yr */
  annual: number;
  error?: string;
}

const perUnit = (p: CostParams, a: number) => p.a + p.b * Math.pow(a, p.c);

/** Capital cost of n units sharing total area A equally. */
function shared(n: number, area: number, unitCost: (a: number) => number): number {
  if (n <= 0) return 0;
  return n * unitCost(area / n);
}

/**
 * Capital cost target. Area is assumed to be shared equally between units of
 * the same type (standard practice for targeting).
 */
export function capitalCost(model: CapitalModel, input: CapitalInput, econ: Economics): CapitalResult {
  const f = annualisationFactor(econ.interestRate, econ.plantLife);
  const { area, units } = input;
  let capital = 0;
  try {
    switch (model.kind) {
      case 'power':
        capital = shared(units.total, area.total, (a) => perUnit(model.params, a));
        break;
      case 'linear':
        capital = shared(units.total, area.total, (a) => model.a + model.b * a);
        break;
      case 'separate': {
        // If a unit type has area but no units (approximate split), give its area to exchangers.
        let ex = area.exchanger;
        let he = area.heater;
        let co = area.cooler;
        if (units.heater === 0) {
          ex += he;
          he = 0;
        }
        if (units.cooler === 0) {
          ex += co;
          co = 0;
        }
        let nEx = units.exchanger;
        if (nEx === 0 && ex > 1e-9) nEx = 1;
        capital =
          shared(nEx, ex, (a) => perUnit(model.exchanger, a)) +
          shared(units.heater, he, (a) => perUnit(model.heater, a)) +
          shared(units.cooler, co, (a) => perUnit(model.cooler, a));
        break;
      }
      case 'custom': {
        const fn = compileExpression(model.expression);
        capital = shared(units.total, area.total, fn);
        break;
      }
    }
  } catch (e) {
    return { capital: NaN, annual: NaN, error: e instanceof Error ? e.message : String(e) };
  }
  if (!Number.isFinite(capital)) return { capital: NaN, annual: NaN, error: 'Capital cost is not a finite number.' };
  return { capital, annual: capital * f };
}
