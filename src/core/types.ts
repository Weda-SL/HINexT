/**
 * HINexT core data model.
 *
 * Principle: projects store INPUTS only. Everything derived (cascade, curves,
 * targets, costs) is recalculated by `analyse()` and never saved.
 * All values are SI internally: °C, kW, kW/K, kW/(m²·K), m², $/yr.
 */

export type StreamSpec = 'cp' | 'duty';

/** One segment of a non-linear profile, between two consecutive temperature points. */
export interface ProfileSegment {
  /** Which of CP or heat load the user typed for this segment */
  spec: StreamSpec;
  /** kW/K. Not used for a phase-change segment (equal temperatures). */
  cp?: number;
  /** kW, positive */
  duty?: number;
  /** Film coefficient for this segment, kW/(m²·K) */
  h?: number;
}

/**
 * Non-linear temperature–enthalpy profile: temperature points in order, with
 * one segment between each consecutive pair. Two equal consecutive temperatures
 * make a phase-change segment (heat load only). The profile may extend beyond
 * the stream's supply and target temperatures; only the part between them is used.
 */
export interface NonLinearProfile {
  /** Temperature points, °C, in order (rising or falling) */
  temps: number[];
  /** segments.length === temps.length − 1 */
  segments: ProfileSegment[];
  /** When true, the stream's own h applies to every segment */
  hConstant: boolean;
}

export interface Stream {
  /** Permanent ID — never a position or display name. */
  id: string;
  name: string;
  /** Supply temperature, °C */
  tSupply: number;
  /** Target temperature, °C */
  tTarget: number;
  /** Which of CP or duty the user entered. The other is derived. */
  spec: StreamSpec;
  /** Heat capacity flowrate, kW/K (used when spec = 'cp') */
  cp?: number;
  /** Heat load, kW, always positive (used when spec = 'duty') */
  duty?: number;
  /** Film heat transfer coefficient, kW/(m²·K) — needed for area targets */
  h?: number;
  /** Individual ΔT contribution, K. null/undefined = ΔTmin/2 */
  dtCont?: number | null;
  /** 'linear' (default) uses cp/duty; 'nonlinear' uses the profile below */
  profile?: 'linear' | 'nonlinear';
  profileData?: NonLinearProfile;
}

export type UtilityKind = 'hot' | 'cold';

export interface Utility {
  id: string;
  name: string;
  kind: UtilityKind;
  /** °C. Equal supply and target = isothermal (e.g. condensing steam). */
  tSupply: number;
  tTarget: number;
  /** Operating cost, $ per kW per year */
  cost: number;
  /**
   * Optional upper limit on this utility's duty, kW. The targeting gives it as
   * much as it can up to this limit; the rest passes to the next utility.
   */
  maxDuty?: number | null;
  /** Film coefficient, kW/(m²·K) */
  h?: number;
  /** Individual ΔT contribution, K. null/undefined = ΔTmin/2 */
  dtCont?: number | null;
}

export interface CostParams {
  /** Fixed cost per unit, $ */
  a: number;
  /** Area coefficient, $/m^c */
  b: number;
  /** Area exponent */
  c: number;
}

export type CapitalModel =
  /** Cost per unit = a + b·A^c (A = area per unit) */
  | { kind: 'power'; params: CostParams }
  /** Cost per unit = a + b·A */
  | { kind: 'linear'; a: number; b: number }
  /** Separate power-law parameters for exchangers, heaters and coolers */
  | { kind: 'separate'; exchanger: CostParams; heater: CostParams; cooler: CostParams }
  /** User-defined cost per unit as an expression in A (m²), e.g. "10000 + 800*A^0.8" */
  | { kind: 'custom'; expression: string };

export interface Economics {
  capital: CapitalModel;
  /** Interest rate as a fraction, e.g. 0.1 for 10 % */
  interestRate: number;
  /** Plant life, years */
  plantLife: number;
}

export type TemperatureUnit = 'C' | 'K';
export type PowerUnit = 'kW' | 'MW';

export interface Settings {
  /** Global minimum approach temperature, K */
  dtMin: number;
  units: { temperature: TemperatureUnit; power: PowerUnit };
  /** ΔTmin range for supertargeting */
  sweep: { min: number; max: number; steps: number };
}

export const SCHEMA_VERSION = 1 as const;

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  streams: Stream[];
  utilities: Utility[];
  settings: Settings;
  economics: Economics;
}
