import { EXAMPLES } from '../src/examples';
import type { NetUnit, Project } from '../src/core/types';

/** Kemp four-stream problem, ΔTmin = 10 K: the textbook MER design (pinch 90/80 °C). */
export function kempMER(): Project {
  const p = EXAMPLES[0].build();
  const units: NetUnit[] = [
    { id: 'E1', kind: 'exchanger', hot: 's2', cold: 's3', load: 240, x: 0.3 },
    { id: 'E2', kind: 'exchanger', hot: 's4', cold: 's1', load: 90, x: 0.35 },
    { id: 'H1', kind: 'heater', cold: 's1', utility: 'u1', load: 20, x: 0.1 },
    { id: 'E3', kind: 'exchanger', hot: 's2', cold: 's1', load: 90, x: 0.6 },
    { id: 'E4', kind: 'exchanger', hot: 's4', cold: 's1', load: 30, x: 0.7 },
    { id: 'C1', kind: 'cooler', hot: 's4', utility: 'u2', load: 60, x: 0.9 },
  ];
  return { ...p, network: { units } };
}

