import type { CapitalModel, Economics, Project, Settings, Stream, Utility } from '../core/types';
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
  | { type: 'stream/delete'; id: string }
  | { type: 'stream/duplicate'; id: string }
  | { type: 'utility/add'; kind: Utility['kind'] }
  | { type: 'utility/update'; id: string; patch: Partial<Utility> }
  | { type: 'utility/delete'; id: string }
  | { type: 'settings/dtMin'; dtMin: number }
  | { type: 'settings/units'; units: Partial<Settings['units']> }
  | { type: 'settings/sweep'; sweep: Partial<Settings['sweep']> }
  | { type: 'economics/update'; patch: Partial<Omit<Economics, 'capital'>> }
  | { type: 'economics/capital'; capital: CapitalModel };

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
  }
}
