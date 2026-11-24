import type { CapitalModel, Economics, NetUnit, Network, NonLinearProfile, Project, Settings, Stream, Utility } from '../core/types';
import { newId, newStream, newUtility } from '../core/project';

/**
 * Every change to a project is a named action. The reducer below is the ONLY
 * place a project is modified. This gives undo/redo with readable labels now,
 * and a log that real-time collaboration can replay later (Stage 2C).
 */
export type Action =
  | { type: 'project/load'; project: Project; label?: string }
  | { type: 'project/rename'; name: string }
  | { type: 'stream/add'; stream?: Partial<Stream> }
  | { type: 'stream/update'; id: string; patch: Partial<Stream> }
  | { type: 'stream/setProfile'; id: string; profile: 'linear' | 'nonlinear'; data?: NonLinearProfile; h?: number }
  | { type: 'stream/delete'; id: string }
  | { type: 'stream/duplicate'; id: string }
  | { type: 'utility/add'; kind: Utility['kind'] }
  | { type: 'utility/update'; id: string; patch: Partial<Utility> }
  | { type: 'utility/delete'; id: string }
  | { type: 'settings/dtMin'; dtMin: number }
  | { type: 'settings/units'; units: Partial<Settings['units']> }
  | { type: 'settings/sweep'; sweep: Partial<Settings['sweep']> }
  | { type: 'economics/update'; patch: Partial<Omit<Economics, 'capital'>> }
  | { type: 'economics/capital'; capital: CapitalModel }
  | { type: 'unit/add'; unit: NetUnit; label?: string }
  | { type: 'unit/update'; id: string; patch: Partial<NetUnit>; label?: string }
  | { type: 'unit/delete'; id: string }
  | { type: 'network/set'; units: NetUnit[]; label: string }
  /** Split a stream over one side of the pinch (fractions null removes the split) */
  | { type: 'split/set'; stream: string; side: 'above' | 'below'; fractions: number[] | null; label?: string }
  | { type: 'evolution/record'; label: string }
  | { type: 'evolution/apply'; units: NetUnit[]; label: string }
  | { type: 'evolution/restore'; index: number }
  | { type: 'evolution/clear' };

const FIELD_NAMES: Record<string, string> = {
  name: 'name',
  tSupply: 'supply temperature',
  tTarget: 'target temperature',
  cp: 'CP',
  duty: 'heat load',
  spec: 'CP / heat load choice',
  h: 'film coefficient',
  dtCont: 'ΔT contribution',
  cost: 'cost',
  kind: 'type',
};

function nameOf(p: Project, id: string): string {
  const s = p.streams.find((x) => x.id === id) ?? p.utilities.find((x) => x.id === id);
  return s?.name || 'item';
}

/** Human-readable label for the history list, e.g. "Set CP of H1". */
export function describe(action: Action, p: Project): string {
  switch (action.type) {
    case 'project/load':
      return action.label ?? `Open "${action.project.name}"`;
    case 'project/rename':
      return 'Rename project';
    case 'stream/add':
      return 'Add stream';
    case 'stream/update': {
      const keys = Object.keys(action.patch);
      return `Set ${keys.map((k) => FIELD_NAMES[k] ?? k).join(', ')} of ${nameOf(p, action.id)}`;
    }
    case 'stream/setProfile':
      return action.profile === 'linear' ? `Make ${nameOf(p, action.id)} linear` : `Set non-linear profile of ${nameOf(p, action.id)}`;
    case 'stream/delete':
      return `Delete stream ${nameOf(p, action.id)}`;
    case 'stream/duplicate':
      return `Duplicate stream ${nameOf(p, action.id)}`;
    case 'utility/add':
      return `Add ${action.kind} utility`;
    case 'utility/update': {
      const keys = Object.keys(action.patch);
      return `Set ${keys.map((k) => FIELD_NAMES[k] ?? k).join(', ')} of ${nameOf(p, action.id)}`;
    }
    case 'utility/delete':
      return `Delete utility ${nameOf(p, action.id)}`;
    case 'settings/dtMin':
      return `Set ΔTmin to ${+action.dtMin.toFixed(3)} K`;
    case 'settings/units':
      return 'Change display units';
    case 'settings/sweep':
      return 'Change supertargeting range';
    case 'economics/update':
      return 'Change economic data';
    case 'economics/capital':
      return 'Change capital cost model';
    case 'unit/add':
      return action.label ?? `Add ${action.unit.kind}`;
    case 'unit/update':
      return action.label ?? `Edit ${action.patch.load !== undefined ? 'load' : action.patch.x !== undefined ? 'position' : 'unit'}`;
    case 'unit/delete':
      return 'Delete unit';
    case 'network/set':
      return action.label;
    case 'split/set':
      return action.label ?? (action.fractions ? 'Split stream' : 'Remove split');
    case 'evolution/record':
      return action.label;
    case 'evolution/apply':
      return action.label;
    case 'evolution/restore':
      return `Step back to step ${action.index}`;
    case 'evolution/clear':
      return 'Clear evolution history';
  }
}

/**
 * Actions with the same key, fired in quick succession, merge into one undo
 * step (e.g. dragging the ΔTmin slider).
 */
export function coalesceKey(action: Action): string | null {
  switch (action.type) {
    case 'settings/dtMin':
      return 'dtMin';
    case 'project/rename':
      return 'rename';
    case 'unit/update':
      return action.patch.x !== undefined && Object.keys(action.patch).length === 1 ? `move:${action.id}` : null;
    default:
      return null;
  }
}

export function apply(p: Project, action: Action): Project {
  switch (action.type) {
    case 'project/load':
      return action.project;
    case 'project/rename':
      return { ...p, name: action.name };
    case 'stream/add': {
      const n = p.streams.length + 1;
      return { ...p, streams: [...p.streams, newStream({ name: `S${n}`, ...action.stream })] };
    }
    case 'stream/update':
      return { ...p, streams: p.streams.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)) };
    case 'stream/setProfile':
      return {
        ...p,
        streams: p.streams.map((s) =>
          s.id === action.id
            ? { ...s, profile: action.profile, profileData: action.data ?? s.profileData, ...(action.h !== undefined ? { h: Number.isNaN(action.h) ? undefined : action.h } : {}) }
            : s,
        ),
      };
    case 'stream/delete':
      return { ...p, streams: p.streams.filter((s) => s.id !== action.id) };
    case 'stream/duplicate': {
      const i = p.streams.findIndex((s) => s.id === action.id);
      if (i < 0) return p;
      const dup = { ...p.streams[i], id: newId('s'), name: `${p.streams[i].name} (copy)` };
      return { ...p, streams: [...p.streams.slice(0, i + 1), dup, ...p.streams.slice(i + 1)] };
    }
    case 'utility/add':
      return { ...p, utilities: [...p.utilities, newUtility(action.kind)] };
    case 'utility/update':
      return { ...p, utilities: p.utilities.map((u) => (u.id === action.id ? { ...u, ...action.patch } : u)) };
    case 'utility/delete':
      return { ...p, utilities: p.utilities.filter((u) => u.id !== action.id) };
    case 'settings/dtMin':
      return { ...p, settings: { ...p.settings, dtMin: action.dtMin } };
    case 'settings/units':
      return { ...p, settings: { ...p.settings, units: { ...p.settings.units, ...action.units } } };
    case 'settings/sweep':
      return { ...p, settings: { ...p.settings, sweep: { ...p.settings.sweep, ...action.sweep } } };
    case 'economics/update':
      return { ...p, economics: { ...p.economics, ...action.patch } };
    case 'economics/capital':
      return { ...p, economics: { ...p.economics, capital: action.capital } };
    case 'unit/add':
      return withUnits(p, [...(p.network?.units ?? []), action.unit]);
    case 'unit/update':
      return withUnits(p, (p.network?.units ?? []).map((u) => (u.id === action.id ? { ...u, ...action.patch } : u)));
    case 'unit/delete':
      return withUnits(p, (p.network?.units ?? []).filter((u) => u.id !== action.id));
    case 'network/set':
      return withUnits(p, action.units);
    case 'split/set': {
      const others = (p.network?.splits ?? []).filter((sp) => !(sp.stream === action.stream && sp.side === action.side));
      const old = (p.network?.splits ?? []).find((sp) => sp.stream === action.stream && sp.side === action.side);
      const n = action.fractions?.length ?? 0;
      const splits = action.fractions && n >= 2 ? [...others, { id: old?.id ?? newId('sp'), stream: action.stream, side: action.side, fractions: action.fractions }] : others;
      // units on removed branches move to the last remaining branch; with no split the branch is cleared
      const onSide = (u: NetUnit) => (action.side === 'above' ? u.x < 0.5 : u.x >= 0.5);
      const fix = (b: number | undefined) => (n >= 2 ? (b === undefined ? undefined : Math.min(b, n - 1)) : undefined);
      const units = (p.network?.units ?? []).map((u) => {
        if (!onSide(u)) return u;
        if (u.hot === action.stream && u.hotBranch !== undefined) return { ...u, hotBranch: fix(u.hotBranch) };
        if (u.cold === action.stream && u.coldBranch !== undefined) return { ...u, coldBranch: fix(u.coldBranch) };
        return u;
      });
      return { ...p, network: { units, splits } };
    }
    case 'evolution/record':
      return { ...p, evolution: [...(p.evolution ?? []), { id: newId('ev'), label: action.label, units: structuredClone(p.network?.units ?? []) }] };
    case 'evolution/apply': {
      const start = p.evolution?.length ? p.evolution : [{ id: newId('ev'), label: 'Starting network', units: structuredClone(p.network?.units ?? []) }];
      return { ...withUnits(p, action.units), evolution: [...start, { id: newId('ev'), label: action.label, units: structuredClone(action.units) }] };
    }
    case 'evolution/restore': {
      const step = p.evolution?.[action.index];
      if (!step) return p;
      return { ...withUnits(p, structuredClone(step.units)), evolution: p.evolution!.slice(0, action.index + 1) };
    }
    case 'evolution/clear':
      return { ...p, evolution: [] };
  }
}

/** Replace the network's units, keeping its stream splits. */
function withUnits(p: Project, units: NetUnit[]): Project {
  const network: Network = { ...(p.network ?? {}), units };
  return { ...p, network };
}
