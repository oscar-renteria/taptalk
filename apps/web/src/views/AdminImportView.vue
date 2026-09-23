<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { AppButton, AppCard, LoadingState, StatusMessage } from '../components';
import { apiFetch, jsonRequest } from '../api';
import type { Tone } from '../types';

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
    else adminMessage.value = payload.error?.message ?? 'Import history could not be loaded.';
  } catch {
    adminTone.value = 'error';
    adminMessage.value = 'Import history could not be loaded.';
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
      adminMessage.value = payload.error?.message ?? 'Preview could not be created.';
      return;
    }
    adminPreview.value = payload.preview;
  } catch {
    adminTone.value = 'error';
    adminMessage.value = 'Preview could not be created.';
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
      adminMessage.value = payload.error?.message ?? 'Import could not be committed.';
      return;
    }
    adminPreview.value = null;
    adminContent.value = '';
    await loadImportHistory();
    adminTone.value = 'success';
    adminMessage.value = 'Import committed successfully.';
  } catch {
    adminTone.value = 'error';
    adminMessage.value = 'Import could not be committed.';
  } finally {
    adminLoading.value = false;
  }
}
</script>

<template>
  <section class="content-section" aria-labelledby="import-title">
    <p class="eyebrow">Administrator tools</p>
    <h1 id="import-title">Manage vocabulary.</h1>
    <div class="field">
      <label for="vocabulary-file">Vocabulary JSON file</label>
      <input
        id="vocabulary-file"
        type="file"
        accept="application/json,.json"
        @change="selectImportFile"
      />
    </div>
    <p v-if="adminSourceName" class="muted">Selected: {{ adminSourceName }}</p>
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
        >{{ adminPreview.additions.length }} additions ·
        {{ adminPreview.updates.length }} updates</span
      >
      <span v-if="adminPreview.invalid.length" class="muted"
        >{{ adminPreview.invalid.length }} invalid records</span
      >
      <span v-if="adminPreview.duplicates.length" class="muted"
        >{{ adminPreview.duplicates.length }} duplicates</span
      >
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
    <StatusMessage v-if="adminMessage" :tone="adminTone" :message="adminMessage" />
    <h2>Import history</h2>
    <LoadingState v-if="adminLoading && !adminHistory.length" label="Loading history..." />
    <ul v-else-if="adminHistory.length" class="history-list" aria-label="Import history">
      <li v-for="item in adminHistory" :key="item.id">
        <strong>{{ item.sourceName || 'Unnamed import' }}</strong>
        <span
          >{{ item.status }} · {{ item.recordCount }} records · {{ item.addedCount }} added</span
        >
      </li>
    </ul>
    <p v-else class="muted">No imports yet.</p>
  </section>
</template>
