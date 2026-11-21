import { SCHEMA_VERSION, type Project, type Stream, type Utility } from './types';

let counter = 0;
/** Permanent unique ID. Uses crypto.randomUUID where available. */
export function newId(prefix: string): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const rand = c?.randomUUID ? c.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  counter = (counter + 1) % 1e6;
  return `${prefix}_${rand}${counter.toString(36)}`;
}

export function defaultEconomics(): Project['economics'] {
  return {
    capital: { kind: 'power', params: { a: 10000, b: 800, c: 0.8 } },
    interestRate: 0.1,
    plantLife: 5,
  };
}

export function emptyProject(name = 'Untitled project'): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('prj'),
    name,
    streams: [],
    utilities: [
      { id: newId('u'), name: 'Steam', kind: 'hot', tSupply: 250, tTarget: 250, cost: 120, h: 5 },
      { id: newId('u'), name: 'Cooling water', kind: 'cold', tSupply: 15, tTarget: 25, cost: 10, h: 1 },
    ],
    settings: {
      dtMin: 10,
      units: { temperature: 'C', power: 'kW' },
      sweep: { min: 1, max: 40, steps: 80 },
    },
    economics: defaultEconomics(),
  };
}

export function newStream(partial: Partial<Stream> = {}): Stream {
  return { id: newId('s'), name: '', tSupply: NaN, tTarget: NaN, spec: 'cp', cp: NaN, h: undefined, dtCont: null, ...partial };
}

export function newUtility(kind: Utility['kind']): Utility {
  return kind === 'hot'
    ? { id: newId('u'), name: 'Hot utility', kind, tSupply: 200, tTarget: 200, cost: 100, h: 5 }
    : { id: newId('u'), name: 'Cold utility', kind, tSupply: 15, tTarget: 25, cost: 10, h: 1 };
}

// ---------------------------------------------------------------------------
// File format (.pinch) — versioned JSON with automatic upgrades.
// ---------------------------------------------------------------------------

export const FILE_KIND = 'hinext-project';

export interface PinchFile {
  kind: typeof FILE_KIND;
  schemaVersion: number;
  savedAt: string;
  app: string;
  project: Project;
}

export function toFile(project: Project, appVersion: string): PinchFile {
  return { kind: FILE_KIND, schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), app: `HINexT ${appVersion}`, project };
}

type Migration = (p: Record<string, unknown>) => Record<string, unknown>;

/**
 * Upgrade steps, keyed by the version they upgrade FROM.
 * Add an entry here whenever SCHEMA_VERSION is bumped.
 */
const MIGRATIONS: Record<number, Migration> = {};

/** NaN is not valid JSON; store missing numbers as null and restore them as NaN. */
export function serialise(file: PinchFile): string {
  return JSON.stringify(file, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2);
}

const NUMERIC_FIELDS = ['tSupply', 'tTarget', 'cp', 'duty'];

/** Parse a .pinch file (or a bare project), upgrading old versions. Throws with a readable message. */
export function parseFile(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!raw || typeof raw !== 'object') throw new Error('This file does not contain a HINexT project.');
  const obj = raw as Record<string, unknown>;
  let project = (obj.kind === FILE_KIND ? obj.project : obj) as Record<string, unknown> | undefined;
  if (!project || typeof project !== 'object' || !Array.isArray(project.streams)) {
    throw new Error('This file does not contain a HINexT project.');
  }
  let version = typeof project.schemaVersion === 'number' ? project.schemaVersion : 1;
  if (version > SCHEMA_VERSION) {
    throw new Error(`This file was made by a newer version of HINexT (schema ${version}). Please update the app.`);
  }
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`No upgrade path from schema version ${version}.`);
    project = step(project);
    version++;
  }
  project.schemaVersion = SCHEMA_VERSION;
  const p = project as unknown as Project;
  const base = emptyProject();
  p.id ??= base.id;
  p.name ??= 'Imported project';
  p.utilities ??= [];
  p.settings = { ...base.settings, ...(p.settings ?? {}), units: { ...base.settings.units, ...(p.settings?.units ?? {}) }, sweep: { ...base.settings.sweep, ...(p.settings?.sweep ?? {}) } };
  p.economics = { ...base.economics, ...(p.economics ?? {}) };
  for (const s of p.streams) {
    for (const f of NUMERIC_FIELDS) if ((s as unknown as Record<string, unknown>)[f] === null) (s as unknown as Record<string, unknown>)[f] = NaN;
    s.id ??= newId('s');
    s.spec ??= 'cp';
  }
  for (const u of p.utilities) u.id ??= newId('u');
  return p;
}
