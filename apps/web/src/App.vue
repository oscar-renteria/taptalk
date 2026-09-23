<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

type User = { username: string; role: string };
type Question = {
  vocabularyEntryId: string;
  direction: 'english-to-german' | 'german-to-english';
  prompt: string;
  phonetics: string | null;
};
type Dashboard = {
  totalPoints: number;
  totalAttempts: number;
  accuracy: number;
  recentActivity: Array<{ attemptedAt: string; direction: string; correct: boolean }>;
  repeatedErrorWords: string[];
};
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

const mode = ref<'login' | 'register'>('login');
const username = ref('');
const password = ref('');
const user = ref<User | null>(null);
const message = ref('');
const loading = ref(false);
const view = ref<'practice' | 'progress' | 'settings' | 'admin-import'>('practice');
const direction = ref('random');
const question = ref<Question | null>(null);
const submittedAnswer = ref('');
const practiceMessage = ref('');
const practiceLoading = ref(false);
const dashboard = ref<Dashboard | null>(null);
const dashboardLoading = ref(false);
const settingsLoading = ref(false);
const settingsMessage = ref('');
const adminContent = ref('');
const adminSourceName = ref('');
const adminPreview = ref<ImportPreview | null>(null);
const adminHistory = ref<ImportHistory[]>([]);
const adminMessage = ref('');
const adminLoading = ref(false);
const networkUnavailable = ref(typeof navigator !== 'undefined' && !navigator.onLine);

function updateNetworkState(): void {
  networkUnavailable.value = !navigator.onLine;
}

onMounted(() => {
  window.addEventListener('online', updateNetworkState);
  window.addEventListener('offline', updateNetworkState);
});

onUnmounted(() => {
  window.removeEventListener('online', updateNetworkState);
  window.removeEventListener('offline', updateNetworkState);
});

async function submit(): Promise<void> {
  loading.value = true;
  message.value = '';
  try {
    const response = await fetch(`/api/v1/auth/${mode.value}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    const payload = (await response.json()) as { user?: User; error?: { message?: string } };
    if (!response.ok || !payload.user) {
      message.value = payload.error?.message ?? 'The request could not be completed.';
      return;
    }
    user.value = payload.user;
    password.value = '';
  } catch {
    message.value = 'The service is unavailable. Try again in a moment.';
  } finally {
    loading.value = false;
  }
}

async function logout(): Promise<void> {
  await fetch('/api/v1/auth/logout', { method: 'POST' });
  user.value = null;
  mode.value = 'login';
}

async function startPractice(): Promise<void> {
  practiceLoading.value = true;
  practiceMessage.value = '';
  question.value = null;
  try {
    const response = await fetch(`/api/v1/practice/question?direction=${direction.value}`);
    const payload = (await response.json()) as {
      question?: Question;
      error?: { message?: string };
    };
    if (!response.ok || !payload.question) {
      practiceMessage.value = payload.error?.message ?? 'No question is available yet.';
      return;
    }
    question.value = payload.question;
    submittedAnswer.value = '';
  } catch {
    practiceMessage.value = 'The practice service is unavailable.';
  } finally {
    practiceLoading.value = false;
  }
}

async function submitAnswer(): Promise<void> {
  if (!question.value) return;
  practiceLoading.value = true;
  try {
    const response = await fetch('/api/v1/practice/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vocabularyEntryId: question.value.vocabularyEntryId,
        direction: question.value.direction,
        prompt: question.value.prompt,
        submittedAnswer: submittedAnswer.value,
      }),
    });
    const payload = (await response.json()) as {
      result?: { correct: boolean; scoreDelta: number; correctAnswer: string };
      error?: { message?: string };
    };
    if (!response.ok || !payload.result) {
      practiceMessage.value = payload.error?.message ?? 'The answer could not be submitted.';
      return;
    }
    practiceMessage.value = payload.result.correct
      ? `Correct. +${payload.result.scoreDelta} points.`
      : `Not quite. The answer is ${payload.result.correctAnswer}.`;
  } catch {
    practiceMessage.value = 'The answer could not be submitted.';
  } finally {
    practiceLoading.value = false;
  }
}

async function selectView(
  nextView: 'practice' | 'progress' | 'settings' | 'admin-import',
): Promise<void> {
  view.value = nextView;
  if (nextView === 'progress' && !dashboardLoading.value) {
    dashboardLoading.value = true;
    try {
      const response = await fetch('/api/v1/dashboard');
      const payload = (await response.json()) as { dashboard?: Dashboard };
      if (response.ok && payload.dashboard) dashboard.value = payload.dashboard;
    } finally {
      dashboardLoading.value = false;
    }
  }
  if (nextView === 'admin-import' && user.value?.role === 'administrator') {
    adminLoading.value = true;
    adminMessage.value = '';
    try {
      const response = await fetch('/api/v1/admin/vocabulary/imports');
      const payload = (await response.json()) as {
        imports?: ImportHistory[];
        error?: { message?: string };
      };
      if (response.ok && payload.imports) adminHistory.value = payload.imports;
      else adminMessage.value = payload.error?.message ?? 'Import history could not be loaded.';
    } catch {
      adminMessage.value = 'Import history could not be loaded.';
    } finally {
      adminLoading.value = false;
    }
    return;
  }
  if (nextView !== 'settings' || settingsLoading.value) return;
  settingsLoading.value = true;
  settingsMessage.value = '';
  try {
    const response = await fetch('/api/v1/settings');
    const payload = (await response.json()) as { settings?: { direction?: string } };
    if (response.ok && payload.settings?.direction) direction.value = payload.settings.direction;
  } catch {
    settingsMessage.value = 'Settings could not be loaded.';
  } finally {
    settingsLoading.value = false;
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
    const response = await fetch('/api/v1/admin/vocabulary/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: adminContent.value, sourceName: adminSourceName.value }),
    });
    const payload = (await response.json()) as {
      preview?: ImportPreview;
      error?: { message?: string };
    };
    if (!response.ok || !payload.preview) {
      adminMessage.value = payload.error?.message ?? 'Preview could not be created.';
      return;
    }
    adminPreview.value = payload.preview;
  } catch {
    adminMessage.value = 'Preview could not be created.';
  } finally {
    adminLoading.value = false;
  }
}

async function commitImport(): Promise<void> {
  adminLoading.value = true;
  adminMessage.value = '';
  try {
    const response = await fetch('/api/v1/admin/vocabulary/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: adminContent.value,
        sourceName: adminSourceName.value,
        confirm: true,
      }),
    });
    const payload = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) {
      adminMessage.value = payload.error?.message ?? 'Import could not be committed.';
      return;
    }
    adminMessage.value = 'Import committed successfully.';
    await selectView('admin-import');
  } catch {
    adminMessage.value = 'Import could not be committed.';
  } finally {
    adminLoading.value = false;
  }
}

async function saveSettings(): Promise<void> {
  settingsLoading.value = true;
  settingsMessage.value = '';
  try {
    const response = await fetch('/api/v1/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        direction: direction.value,
        sessionLength: 10,
        repetitionPreference: 'balanced',
      }),
    });
    settingsMessage.value = response.ok ? 'Settings saved.' : 'Settings could not be saved.';
  } catch {
    settingsMessage.value = 'Settings could not be saved.';
  } finally {
    settingsLoading.value = false;
  }
}
</script>

<template>
  <main class="shell">
    <p v-if="networkUnavailable" class="offline-banner" role="status">
      You are offline. Practice and account data need a connection.
    </p>
    <section v-if="!user" class="panel" aria-labelledby="page-title">
      <p class="eyebrow">TapTalk</p>
      <h1 id="page-title">Small steps. Stronger words.</h1>
      <p class="intro">A quiet place to build your German, one answer at a time.</p>
      <form @submit.prevent="submit">
        <label for="username">Username</label>
        <input id="username" v-model="username" autocomplete="username" required minlength="2" />
        <label for="password">Password</label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          minlength="8"
        />
        <button type="submit" :disabled="loading">
          {{ loading ? 'Working...' : mode === 'login' ? 'Log in' : 'Create account' }}
        </button>
      </form>
      <p v-if="message" class="message" role="alert">{{ message }}</p>
      <button
        class="text-button"
        type="button"
        @click="mode = mode === 'login' ? 'register' : 'login'"
      >
        {{ mode === 'login' ? 'Need an account?' : 'Already have an account?' }}
      </button>
    </section>
    <section v-else class="panel" aria-labelledby="welcome-title">
      <header class="app-header">
        <div>
          <p class="eyebrow">TapTalk practice desk</p>
          <p class="user-label">{{ user.username }}</p>
        </div>
        <button class="text-button" type="button" @click="logout">Log out</button>
      </header>
      <nav class="tabs" aria-label="Main navigation">
        <button
          v-for="item in [
            { id: 'practice', label: 'Practice' },
            { id: 'progress', label: 'Progress' },
            { id: 'settings', label: 'Settings' },
          ]"
          :key="item.id"
          class="tab"
          :class="{ active: view === item.id }"
          type="button"
          :aria-current="view === item.id ? 'page' : undefined"
          @click="selectView(item.id as 'practice' | 'progress' | 'settings')"
        >
          {{ item.label }}
        </button>
        <button
          v-if="user.role === 'administrator'"
          class="tab"
          :class="{ active: view === 'admin-import' }"
          type="button"
          :aria-current="view === 'admin-import' ? 'page' : undefined"
          @click="selectView('admin-import')"
        >
          Import vocabulary
        </button>
      </nav>
      <section v-if="view === 'practice'" class="content-section" aria-labelledby="practice-title">
        <p class="eyebrow">Today’s session</p>
        <h1 id="practice-title">Ready when you are.</h1>
        <p class="intro">Choose a direction, then begin a short focused practice round.</p>
        <label for="direction">Practice direction</label>
        <select id="direction" v-model="direction">
          <option value="random">Random direction</option>
          <option value="english-to-german">English to German</option>
          <option value="german-to-english">German to English</option>
        </select>
        <button type="button" :disabled="practiceLoading" @click="startPractice">
          {{ practiceLoading ? 'Loading...' : 'Start practice' }}
        </button>
        <form v-if="question" class="practice-card" @submit.prevent="submitAnswer">
          <p class="prompt">{{ question.prompt }}</p>
          <p v-if="question.phonetics" class="muted">{{ question.phonetics }}</p>
          <label for="answer">Your answer</label>
          <input id="answer" v-model="submittedAnswer" autocomplete="off" autofocus />
          <button type="submit" :disabled="practiceLoading">Submit answer</button>
        </form>
        <p v-if="practiceMessage" class="message" role="status">{{ practiceMessage }}</p>
      </section>
      <section
        v-else-if="view === 'progress'"
        class="content-section"
        aria-labelledby="progress-title"
      >
        <p class="eyebrow">Your progress</p>
        <h1 id="progress-title">A clear beginning.</h1>
        <p v-if="dashboardLoading" class="muted">Loading your progress...</p>
        <div v-else-if="dashboard" class="stat-grid">
          <div class="stat">
            <strong>{{ dashboard.totalPoints }}</strong
            ><span>points</span>
          </div>
          <div class="stat">
            <strong>{{ dashboard.totalAttempts }}</strong
            ><span>attempts</span>
          </div>
          <div class="stat">
            <strong>{{ Math.round(dashboard.accuracy * 100) }}%</strong><span>accuracy</span>
          </div>
        </div>
        <p v-if="dashboard && dashboard.repeatedErrorWords.length" class="muted">
          Keep an eye on: {{ dashboard.repeatedErrorWords.join(', ') }}.
        </p>
        <p v-else-if="!dashboardLoading" class="muted">
          Complete a practice round to see your learning history here.
        </p>
      </section>
      <section
        v-else-if="view === 'settings'"
        class="content-section"
        aria-labelledby="settings-title"
      >
        <p class="eyebrow">Your preferences</p>
        <h1 id="settings-title">Set your rhythm.</h1>
        <label for="settings-direction">Default direction</label>
        <select id="settings-direction" v-model="direction">
          <option value="random">Random direction</option>
          <option value="english-to-german">English to German</option>
          <option value="german-to-english">German to English</option>
        </select>
        <button type="button" :disabled="settingsLoading" @click="saveSettings">
          {{ settingsLoading ? 'Saving...' : 'Save settings' }}
        </button>
        <p v-if="settingsMessage" class="message" role="status">{{ settingsMessage }}</p>
      </section>
      <section v-else class="content-section" aria-labelledby="import-title">
        <p class="eyebrow">Administrator tools</p>
        <h1 id="import-title">Manage vocabulary.</h1>
        <label for="vocabulary-file">Vocabulary JSON file</label>
        <input
          id="vocabulary-file"
          type="file"
          accept="application/json,.json"
          @change="selectImportFile"
        />
        <p v-if="adminSourceName" class="muted">Selected: {{ adminSourceName }}</p>
        <button type="button" :disabled="adminLoading || !adminContent" @click="previewImport">
          {{ adminLoading ? 'Working...' : 'Preview import' }}
        </button>
        <div v-if="adminPreview" class="preview-summary" aria-live="polite">
          <strong>{{ adminPreview.valid.length }} valid records</strong>
          <span
            >{{ adminPreview.additions.length }} additions ·
            {{ adminPreview.updates.length }} updates</span
          >
          <span v-if="adminPreview.invalid.length"
            >{{ adminPreview.invalid.length }} invalid records</span
          >
          <span v-if="adminPreview.duplicates.length"
            >{{ adminPreview.duplicates.length }} duplicates</span
          >
          <button
            type="button"
            :disabled="
              adminLoading ||
              !!adminPreview.invalid.length ||
              !!adminPreview.duplicates.length ||
              !adminPreview.valid.length
            "
            @click="commitImport"
          >
            Confirm and import
          </button>
        </div>
        <p v-if="adminMessage" class="message" role="status">{{ adminMessage }}</p>
        <h2>Import history</h2>
        <p v-if="adminLoading && !adminHistory.length" class="muted">Loading history...</p>
        <ul v-else-if="adminHistory.length" class="history-list">
          <li v-for="item in adminHistory" :key="item.id">
            <strong>{{ item.sourceName || 'Unnamed import' }}</strong>
            <span
              >{{ item.status }} · {{ item.recordCount }} records ·
              {{ item.addedCount }} added</span
            >
          </li>
        </ul>
        <p v-else class="muted">No imports yet.</p>
      </section>
    </section>
  </main>
</template>
