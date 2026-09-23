import { reactive } from 'vue';

type RegisterSW = (options: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}) => (reloadPage?: boolean) => Promise<void>;

// Service worker state for the UI. `registerSW` is passed in by main.ts, so this module does not
// depend on the build-time virtual module and stays unit-testable.
export const pwa = reactive({ updateAvailable: false, offlineReady: false });

let updateServiceWorker: (reloadPage?: boolean) => Promise<void> = async () => undefined;

export function setupPwa(registerSW: RegisterSW): void {
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      pwa.updateAvailable = true;
    },
    onOfflineReady: () => {
      pwa.offlineReady = true;
    },
  });
}

// Activates the waiting service worker and reloads into the new version.
export function applyUpdate(): Promise<void> {
  pwa.updateAvailable = false;
  return updateServiceWorker(true);
}

export function dismissUpdate(): void {
  pwa.updateAvailable = false;
}
