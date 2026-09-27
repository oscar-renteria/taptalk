<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { onMounted, ref } from 'vue';
import { AppButton, AppCard, LoadingState, LiveMessage } from '../components';
import { apiFetch, jsonRequest } from '../api';
import type { Tone } from '../types';
const { t } = useI18n();

type ImportPreview = {
  valid: Array<{ english: string; german: string; alternatives: string[] }>;
  invalid: Array<{ index: number; error: string }>;
  duplicates: number[];
  additions: string[];
  updates: string[];
  warnings: string[];
};
type ImportHistory = {
  id: string;
  sourceName: string | null;
  status: string;
  recordCount: number;
  addedCount: number;
  updatedCount: number;
  errorCount: number;
  createdAt: string;
};

const adminContent = ref('');
const adminSourceName = ref('');
const adminPreview = ref<ImportPreview | null>(null);
const adminHistory = ref<ImportHistory[]>([]);
const adminMessage = ref('');
const adminTone = ref<Tone>('info');
const adminLoading = ref(false);

onMounted(loadImportHistory);

async function loadImportHistory(): Promise<void> {
  adminLoading.value = true;
  try {
    const response = await apiFetch('/api/v1/admin/vocabulary/imports');
    const payload = (await response.json()) as {
      imports?: ImportHistory[];
      error?: { message?: string };
    };
    if (response.ok && payload.imports) adminHistory.value = payload.imports;
    else adminMessage.value = payload.error?.message ?? t('admin.historyFailed');
  } catch {
    adminTone.value = 'error';
    adminMessage.value = t('admin.historyFailed');
  } finally {
    adminLoading.value = false;
  }
}

async function selectImportFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  adminSourceName.value = file.name;
  adminContent.value = await file.text();
  adminPreview.value = null;
  adminMessage.value = '';
}

async function previewImport(): Promise<void> {
  adminLoading.value = true;
  adminMessage.value = '';
  try {
    const response = await apiFetch(
      '/api/v1/admin/vocabulary/preview',
      jsonRequest('POST', { content: adminContent.value, sourceName: adminSourceName.value }),
    );
    const payload = (await response.json()) as {
      preview?: ImportPreview;
      error?: { message?: string };
    };
    if (!response.ok || !payload.preview) {
      adminTone.value = 'error';
      adminMessage.value = payload.error?.message ?? t('admin.previewFailed');
      return;
    }
    adminPreview.value = payload.preview;
  } catch {
    adminTone.value = 'error';
    adminMessage.value = t('admin.previewFailed');
  } finally {
    adminLoading.value = false;
  }
}

async function commitImport(): Promise<void> {
  adminLoading.value = true;
  adminMessage.value = '';
  try {
    const response = await apiFetch(
      '/api/v1/admin/vocabulary/import',
      jsonRequest('POST', {
        content: adminContent.value,
        sourceName: adminSourceName.value,
        confirm: true,
      }),
    );
    const payload = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) {
      adminTone.value = 'error';
      adminMessage.value = payload.error?.message ?? t('admin.failed');
      return;
    }
    adminPreview.value = null;
    adminContent.value = '';
    await loadImportHistory();
    adminTone.value = 'success';
    adminMessage.value = t('admin.success');
  } catch {
    adminTone.value = 'error';
    adminMessage.value = t('admin.failed');
  } finally {
    adminLoading.value = false;
  }
}
</script>

<template>
  <section class="content-section" aria-labelledby="import-title">
    <p class="eyebrow">{{ t('admin.eyebrow') }}</p>
    <h1 id="import-title">{{ t('admin.heading') }}</h1>
    <div class="field">
      <label for="vocabulary-file">{{ t('admin.fileLabel') }}</label>
      <input
        id="vocabulary-file"
        type="file"
        accept="application/json,.json"
        @change="selectImportFile"
      />
    </div>
    <p v-if="adminSourceName" class="muted">
      {{ t('admin.selectedFile', { name: adminSourceName }) }}
    </p>
    <AppButton
      variant="secondary"
      :disabled="!adminContent"
      :loading="adminLoading"
      @click="previewImport"
    >
      Preview import
    </AppButton>
    <AppCard v-if="adminPreview" aria-live="polite">
      <strong>{{ adminPreview.valid.length }} valid records</strong>
      <span class="muted"
        >{{ t('admin.additions', { count: adminPreview.additions.length }) }} ·
        {{ t('admin.updates', { count: adminPreview.updates.length }) }}</span
      >
      <span v-if="adminPreview.invalid.length" class="muted">{{
        t('admin.invalidRecordsCount', { count: adminPreview.invalid.length })
      }}</span>
      <span v-if="adminPreview.duplicates.length" class="muted">{{
        t('admin.duplicatesCount', { count: adminPreview.duplicates.length })
      }}</span>
      <AppButton
        :disabled="
          adminLoading ||
          !!adminPreview.invalid.length ||
          !!adminPreview.duplicates.length ||
          !adminPreview.valid.length
        "
        @click="commitImport"
      >
        Confirm and import
      </AppButton>
    </AppCard>
    <LiveMessage :tone="adminTone" :message="adminMessage" />
    <h2>{{ t('admin.history') }}</h2>
    <LoadingState v-if="adminLoading && !adminHistory.length" :label="t('admin.loadingHistory')" />
    <ul v-else-if="adminHistory.length" class="history-list" :aria-label="t('admin.history')">
      <li v-for="item in adminHistory" :key="item.id">
        <strong>{{ item.sourceName || t('admin.unnamedImport') }}</strong>
        <span>{{
          t('admin.historyEntry', {
            status: item.status,
            records: item.recordCount,
            added: item.addedCount,
          })
        }}</span>
      </li>
    </ul>
    <p v-else class="muted">{{ t('admin.noHistory') }}</p>
  </section>
</template>
