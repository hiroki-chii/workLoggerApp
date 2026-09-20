import { TauriDesktopApi } from './tauri.js';
import { UnavailableDesktopApi } from './unavailable.js';

export function createDesktopApi(runtime = globalThis.window) {
  if (runtime?.__TAURI_INTERNALS__) return new TauriDesktopApi();
  return new UnavailableDesktopApi('Browser');
}

export const desktopApi = createDesktopApi();
