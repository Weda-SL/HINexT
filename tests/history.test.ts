import { describe, expect, it } from 'vitest';
import { historyReducer, initHistory } from '../src/state/history';
import { EXAMPLES } from '../src/examples';

describe('named actions and undo/redo', () => {
  const start = initHistory(EXAMPLES[0].build());

  it('applies an action with a readable label, then undoes and redoes it', () => {
    let s = historyReducer(start, { type: 'do', action: { type: 'stream/update', id: 's2', patch: { cp: 3.5 } } });
    expect(s.present.label).toBe('Set CP of Hot 2');
    expect(s.present.project.streams[1].cp).toBe(3.5);
    s = historyReducer(s, { type: 'undo' });
    expect(s.present.project.streams[1].cp).toBe(3);
    s = historyReducer(s, { type: 'redo' });
    expect(s.present.project.streams[1].cp).toBe(3.5);
  });

  it('merges rapid ΔTmin changes into one undo step', () => {
    let s = historyReducer(start, { type: 'do', action: { type: 'settings/dtMin', dtMin: 11 }, now: 1000 });
    s = historyReducer(s, { type: 'do', action: { type: 'settings/dtMin', dtMin: 12 }, now: 1500 });
    s = historyReducer(s, { type: 'do', action: { type: 'settings/dtMin', dtMin: 13 }, now: 2000 });
    expect(s.past).toHaveLength(1);
    s = historyReducer(s, { type: 'undo' });
    expect(s.present.project.settings.dtMin).toBe(10);
  });

  it('a new action clears the redo stack; add/delete keep permanent IDs', () => {
    let s = historyReducer(start, { type: 'do', action: { type: 'stream/add' } });
    const id = s.present.project.streams[4].id;
    s = historyReducer(s, { type: 'undo' });
    s = historyReducer(s, { type: 'do', action: { type: 'stream/delete', id: 's1' } });
    expect(s.future).toHaveLength(0);
    expect(s.present.project.streams.map((x) => x.id)).toEqual(['s2', 's3', 's4']);
    expect(id).toMatch(/^s_/);
  });
});
