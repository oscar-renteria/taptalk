import type { ShareResultPayload } from '@taptalk/shared';
import { apiFetch, jsonRequest } from './api';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * Create a share for a completed session and hold the state the share sheet needs.
 *
 * The API is asked for the share rather than the card being assembled here: the
 * payload returned is the sanitized one the public page will serve, so the dialog
 * renders exactly what a recipient will see and cannot drift from it.
 *
 * A guest has no durable identity to attach a share to, so the API refuses; this
 * reports that as "not available" rather than surfacing an error.
 */
export function useShareResult() {
  const { t } = useI18n();
  const open = ref(false);
  const loading = ref(false);
  const error = ref('');
  const path = ref('');
  const sessionId = ref<string | null>(null);
  const payload = ref<ShareResultPayload | null>(null);

  async function shareSession(session: string): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const response = await apiFetch(
        '/api/v1/share/results',
        jsonRequest('POST', { sessionId: session }),
      );
      const body = (await response.json()) as { share?: ShareResultPayload & { path?: string } };
      if (!response.ok || !body.share?.path) {
        error.value = t('share.notShareable');
        return;
      }
      path.value = body.share.path;
      payload.value = body.share;
      sessionId.value = session;
      open.value = true;
    } catch {
      error.value = t('share.notShareable');
    } finally {
      loading.value = false;
    }
  }

  function close(): void {
    open.value = false;
  }

  return { open, loading, error, path, sessionId, payload, shareSession, close };
}
