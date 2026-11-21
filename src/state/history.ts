import type { Project } from '../core/types';
import { apply, coalesceKey, describe, type Action } from './actions';

export interface Entry {
  project: Project;
  /** Label of the action that produced this state */
  label: string;
}

export interface HistoryState {
  past: Entry[];
  present: Entry;
  future: Entry[];
  /** For merging rapid repeated actions into one undo step */
  lastKey: string | null;
  lastAt: number;
}

export type HistoryAction =
  | { type: 'do'; action: Action; now?: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'jump'; index: number }
  | { type: 'reset'; project: Project; label?: string };

const MAX_HISTORY = 200;
const COALESCE_MS = 1200;

export function initHistory(project: Project, label = 'Start'): HistoryState {
  return { past: [], present: { project, label }, future: [], lastKey: null, lastAt: 0 };
}

export function historyReducer(state: HistoryState, ha: HistoryAction): HistoryState {
  switch (ha.type) {
    case 'do': {
      const now = ha.now ?? Date.now();
      const next = apply(state.present.project, ha.action);
      if (next === state.present.project) return state;
      const label = describe(ha.action, state.present.project);
      const key = coalesceKey(ha.action);
      if (key && key === state.lastKey && now - state.lastAt < COALESCE_MS && state.future.length === 0) {
        return { ...state, present: { project: next, label }, lastAt: now };
      }
      const past = [...state.past, state.present].slice(-MAX_HISTORY);
      return { past, present: { project: next, label }, future: [], lastKey: key, lastAt: now };
    }
    case 'undo': {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), present: prev, future: [state.present, ...state.future], lastKey: null, lastAt: 0 };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return { past: [...state.past, state.present], present: next, future: rest, lastKey: null, lastAt: 0 };
    }
    case 'reset':
      return initHistory(ha.project, ha.label);
    case 'jump': {
      // index into [...past, present, ...future]
      const all = [...state.past, state.present, ...state.future];
      if (ha.index < 0 || ha.index >= all.length) return state;
      return { past: all.slice(0, ha.index), present: all[ha.index], future: all.slice(ha.index + 1), lastKey: null, lastAt: 0 };
    }
  }
}
