import { SCHEMA_VERSION, type Project } from '../core/types';
import { defaultEconomics } from '../core/project';

/**
 * Built-in benchmark cases. Stream data and published energy targets are from
 * the cited sources. Utility temperatures/costs and film coefficients are
 * ILLUSTRATIVE (chosen for these examples) unless stated otherwise.
 */
export interface Example {
  key: string;
  title: string;
  source: string;
  /** Published targets used by the validation tests */
  published: { dtMin: number; qh: number; qc: number; hotPinch: number; coldPinch: number };
  build: () => Project;
}

const settings = (dtMin: number, sweepMax: number): Project['settings'] => ({
  dtMin,
  units: { temperature: 'C', power: 'kW' },
  sweep: { min: 1, max: sweepMax, steps: 80 },
});

export const EXAMPLES: Example[] = [
  {
    key: 'kemp-4',
    title: 'Four-stream problem (Kemp / Linnhoff et al. User Guide)',
    source:
      'Kemp, I.C. (2007) Pinch Analysis and Process Integration, 2nd ed., Ch. 2 four-stream example; originally Linnhoff et al. (1982) User Guide on Process Integration.',
    published: { dtMin: 10, qh: 20, qc: 60, hotPinch: 90, coldPinch: 80 },
    build: () => ({
      schemaVersion: SCHEMA_VERSION,
      id: 'ex_kemp4',
      name: 'Four-stream problem (Kemp)',
      description: 'Classic four-stream example. ΔTmin = 10 K gives QHmin = 20 kW, QCmin = 60 kW, pinch 90/80 °C.',
      streams: [
        { id: 's1', name: 'Cold 1', tSupply: 20, tTarget: 135, spec: 'cp', cp: 2.0, h: 0.2 },
        { id: 's2', name: 'Hot 2', tSupply: 170, tTarget: 60, spec: 'cp', cp: 3.0, h: 0.2 },
        { id: 's3', name: 'Cold 3', tSupply: 80, tTarget: 140, spec: 'cp', cp: 4.0, h: 0.2 },
        { id: 's4', name: 'Hot 4', tSupply: 150, tTarget: 30, spec: 'cp', cp: 1.5, h: 0.2 },
      ],
      utilities: [
        { id: 'u1', name: 'Steam', kind: 'hot', tSupply: 180, tTarget: 180, cost: 120, h: 0.2 },
        { id: 'u2', name: 'Cooling water', kind: 'cold', tSupply: 10, tTarget: 20, cost: 10, h: 0.2 },
      ],
      settings: settings(10, 40),
      economics: defaultEconomics(),
    }),
  },
  {
    key: 'lh-1983',
    title: 'Linnhoff & Hindmarsh (1983) four-stream problem',
    source:
      'Linnhoff, B. & Hindmarsh, E. (1983) The pinch design method for heat exchanger networks. Chem. Eng. Sci. 38(5), 745–763.',
    published: { dtMin: 20, qh: 107.5, qc: 40, hotPinch: 90, coldPinch: 70 },
    build: () => ({
      schemaVersion: SCHEMA_VERSION,
      id: 'ex_lh1983',
      name: 'Linnhoff & Hindmarsh (1983)',
      description: 'ΔTmin = 20 K gives QHmin = 107.5 kW, QCmin = 40 kW, pinch 90/70 °C.',
      streams: [
        { id: 's1', name: 'H1', tSupply: 150, tTarget: 60, spec: 'cp', cp: 2.0, h: 0.2 },
        { id: 's2', name: 'H2', tSupply: 90, tTarget: 60, spec: 'cp', cp: 8.0, h: 0.2 },
        { id: 's3', name: 'C3', tSupply: 20, tTarget: 125, spec: 'cp', cp: 2.5, h: 0.2 },
        { id: 's4', name: 'C4', tSupply: 25, tTarget: 100, spec: 'cp', cp: 3.0, h: 0.2 },
      ],
      utilities: [
        { id: 'u1', name: 'Steam', kind: 'hot', tSupply: 160, tTarget: 160, cost: 120, h: 0.2 },
        { id: 'u2', name: 'Cooling water', kind: 'cold', tSupply: 15, tTarget: 25, cost: 10, h: 0.2 },
      ],
      settings: settings(20, 50),
      economics: defaultEconomics(),
    }),
  },
  {
    key: 'smith-4',
    title: 'Smith four-stream process (two reactors)',
    source:
      'Smith, R. (2016) Chemical Process Design and Integration, 2nd ed., Wiley — four-stream heat recovery example (reactor feeds and products).',
    published: { dtMin: 10, qh: 750, qc: 1000, hotPinch: 150, coldPinch: 140 },
    build: () => ({
      schemaVersion: SCHEMA_VERSION,
      id: 'ex_smith4',
      name: 'Smith four-stream process',
      description: 'ΔTmin = 10 K gives QHmin = 750 kW, QCmin = 1000 kW, pinch 150/140 °C.',
      streams: [
        { id: 's1', name: 'Reactor 1 feed', tSupply: 20, tTarget: 180, spec: 'cp', cp: 20, h: 0.5 },
        { id: 's2', name: 'Reactor 1 product', tSupply: 250, tTarget: 40, spec: 'cp', cp: 15, h: 0.5 },
        { id: 's3', name: 'Reactor 2 feed', tSupply: 140, tTarget: 230, spec: 'cp', cp: 30, h: 0.5 },
        { id: 's4', name: 'Reactor 2 product', tSupply: 200, tTarget: 80, spec: 'cp', cp: 25, h: 0.5 },
      ],
      utilities: [
        { id: 'u1', name: 'HP steam', kind: 'hot', tSupply: 250, tTarget: 250, cost: 140, h: 2 },
        { id: 'u2', name: 'Cooling water', kind: 'cold', tSupply: 20, tTarget: 30, cost: 10, h: 1 },
      ],
      settings: settings(10, 40),
      economics: defaultEconomics(),
    }),
  },
  {
    key: 'kemp-4-mer',
    title: 'Four-stream problem with its MER network (Kemp)',
    source: 'As above, with the MER design from the pinch design method (6 units, QH = 20 kW, QC = 60 kW). Use it to try network optimization on the Optimization tab (loops and utility paths).',
    published: { dtMin: 10, qh: 20, qc: 60, hotPinch: 90, coldPinch: 80 },
    build: () => {
      const base = EXAMPLES[0].build();
      return {
        ...base,
        id: 'ex_kemp4_mer',
        name: 'Four-stream problem — MER network (Kemp)',
        description: 'Textbook MER design for the four-stream problem; one loop (Hot 4–Cold 1 above and below the pinch).',
        network: {
          units: [
            { id: 'E1', kind: 'exchanger', hot: 's2', cold: 's3', load: 240, x: 0.3 },
            { id: 'E2', kind: 'exchanger', hot: 's4', cold: 's1', load: 90, x: 0.38 },
            { id: 'H1', kind: 'heater', cold: 's1', utility: 'u1', load: 20, x: 0.08 },
            { id: 'E3', kind: 'exchanger', hot: 's2', cold: 's1', load: 90, x: 0.6 },
            { id: 'E4', kind: 'exchanger', hot: 's4', cold: 's1', load: 30, x: 0.72 },
            { id: 'C1', kind: 'cooler', hot: 's4', utility: 'u2', load: 60, x: 0.9 },
          ],
        },
      };
    },
  },
  {
    key: 'smith-split',
    title: 'Stream splitting example (Smith)',
    source:
      'Smith, R. (2016) Chemical Process Design and Integration, 2nd ed., Wiley — stream splitting example in the heat exchanger network design chapter (ΔTmin = 20 K). Utility temperatures and costs and film coefficients are illustrative.',
    published: { dtMin: 20, qh: 9200, qc: 6400, hotPinch: 520, coldPinch: 500 },
    build: () => ({
      schemaVersion: SCHEMA_VERSION,
      id: 'ex_smith_split',
      name: 'Stream splitting example (Smith)',
      description: 'ΔTmin = 20 K gives QHmin = 9.2 MW, QCmin = 6.4 MW, pinch 520/500 °C. Above the pinch, stream 1 (CP 0.045) is larger than both cold streams, so it has to be split.',
      streams: [
        { id: 's1', name: 'Hot 1', tSupply: 720, tTarget: 320, spec: 'cp', cp: 45, h: 0.5 },
        { id: 's2', name: 'Hot 2', tSupply: 520, tTarget: 220, spec: 'cp', cp: 40, h: 0.5 },
        { id: 's3', name: 'Cold 3', tSupply: 300, tTarget: 900, spec: 'cp', cp: 43, h: 0.5 },
        { id: 's4', name: 'Cold 4', tSupply: 200, tTarget: 550, spec: 'cp', cp: 20, h: 0.5 },
      ],
      utilities: [
        { id: 'u1', name: 'Furnace', kind: 'hot', tSupply: 1000, tTarget: 1000, cost: 200, h: 0.5 },
        { id: 'u2', name: 'Cooling water', kind: 'cold', tSupply: 20, tTarget: 30, cost: 10, h: 1 },
      ],
      settings: { ...settings(20, 60), units: { temperature: 'C', power: 'MW' } },
      economics: defaultEconomics(),
    }),
  },
  {
    key: 'smith-split-mer',
    title: 'Stream splitting example with its MER network (Smith)',
    source: 'As above, with the published MER design: stream 1 split above the pinch into CP 0.040 and 0.005 branches (7 units, QH = 9.2 MW, QC = 6.4 MW).',
    published: { dtMin: 20, qh: 9200, qc: 6400, hotPinch: 520, coldPinch: 500 },
    build: () => {
      const base = EXAMPLES.find((e) => e.key === 'smith-split')!.build();
      return {
        ...base,
        id: 'ex_smith_split_mer',
        name: 'Stream splitting example — MER network (Smith)',
        description: 'Published MER design with stream 1 split above the pinch (CP 0.040 to stream 3, CP 0.005 to stream 4).',
        network: {
          splits: [{ id: 'sp1', stream: 's1', side: 'above', fractions: [40 / 45, 5 / 45] }],
          units: [
            { id: 'E1', kind: 'exchanger', hot: 's1', cold: 's3', load: 8000, x: 0.38, hotBranch: 0 },
            { id: 'E2', kind: 'exchanger', hot: 's1', cold: 's4', load: 1000, x: 0.25, hotBranch: 1 },
            { id: 'H1', kind: 'heater', cold: 's3', utility: 'u1', load: 9200, x: 0.06 },
            { id: 'E3', kind: 'exchanger', hot: 's1', cold: 's3', load: 8600, x: 0.6 },
            { id: 'E4', kind: 'exchanger', hot: 's2', cold: 's4', load: 6000, x: 0.68 },
            { id: 'C1', kind: 'cooler', hot: 's1', utility: 'u2', load: 400, x: 0.88 },
            { id: 'C2', kind: 'cooler', hot: 's2', utility: 'u2', load: 6000, x: 0.88 },
          ],
        },
      };
    },
  },
];
