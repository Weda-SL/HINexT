/**
 * Share links: the whole project, compressed, in the URL fragment (#p=…).
 * The fragment is never sent to a server, so nothing is uploaded.
 */
import type { Project } from '../core/types';
import { parseFile, toFile } from '../core/project';

/** Longer links are unreliable in some browsers, chat apps and e-mail clients; use a file instead. */
export const SHARE_LIMIT = 8000;
const PREFIX = 'p=';

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Compressed payload for the fragment (without the leading "#p="). */
export async function encodeShare(project: Project, appVersion: string): Promise<string> {
  const json = JSON.stringify(toFile(project, appVersion), (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return toBase64Url(packed);
}

export async function decodeShare(payload: string): Promise<Project> {
  let text: string;
  try {
    text = new TextDecoder().decode(await pipe(fromBase64Url(payload), new DecompressionStream('deflate-raw')));
  } catch {
    throw new Error('This share link is damaged or incomplete.');
  }
  return parseFile(text);
}

/** The payload in a location hash, if it is a share link. */
export function sharePayload(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  return h.startsWith(PREFIX) ? h.slice(PREFIX.length) : null;
}

export function shareUrl(payload: string, base: string): string {
  return `${base.split('#')[0]}#${PREFIX}${payload}`;
}
