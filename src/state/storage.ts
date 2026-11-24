import type { Project } from '../core/types';
import { parseFile, serialise, toFile } from '../core/project';

export const APP_VERSION = '0.2.0-dev';

/**
 * The app saves and loads only through this interface, without knowing where
 * the data goes. Stage 1: browser storage. Stage 2: a cloud implementation.
 */
export interface ProjectStore {
  save(project: Project): Promise<void>;
  load(): Promise<Project | null>;
}

const KEY = 'hinext:current-project';

export class LocalStore implements ProjectStore {
  async save(project: Project): Promise<void> {
    try {
      localStorage.setItem(KEY, serialise(toFile(project, APP_VERSION)));
    } catch {
      /* storage full or unavailable — the user still has file save */
    }
  }
  async load(): Promise<Project | null> {
    try {
      const text = localStorage.getItem(KEY);
      return text ? parseFile(text) : null;
    } catch {
      return null;
    }
  }
}

/** Ask the browser not to evict our storage (best effort). */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}

export function safeFileName(name: string): string {
  return (name || 'project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'project';
}

/** Download a project as a .pinch file. */
export function downloadProject(project: Project): void {
  downloadText(serialise(toFile(project, APP_VERSION)), `${safeFileName(project.name)}.pinch`, 'application/json');
}

export function downloadText(text: string, filename: string, mime: string): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readProjectFile(file: File): Promise<Project> {
  return parseFile(await file.text());
}
