<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

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
type PracticeSession = { id: string; questionCount: number; answeredCount: number };
type SessionSummary = {
  id: string;
  status: 'active' | 'completed' | 'abandoned';
  questionCount: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  pointsEarned: number;
  accuracy: number;
  wordsToPractice: string[];
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
const sessionChecked = ref(false);
const message = ref('');
const loading = ref(false);
const view = ref<'practice' | 'progress' | 'settings' | 'admin-import'>('practice');
const direction = ref('random');
const question = ref<Question | null>(null);
const submittedAnswer = ref('');
const practiceSession = ref<PracticeSession | null>(null);
const answered = ref(false);
const sessionSummary = ref<SessionSummary | null>(null);
const answerInput = ref<HTMLInputElement | null>(null);
const nextButton = ref<HTMLButtonElement | null>(null);
const summaryHeading = ref<HTMLHeadingElement | null>(null);
const practiceMessage = ref('');
const practiceLoading = ref(false);
const dashboard = ref<Dashboard | null>(null);
const dashboardLoading = ref(false);
const settingsLoading = ref(false);
const settingsMessage = ref('');
const sessionLength = ref(10);
const repetitionPreference = ref<'balanced' | 'errors-first'>('balanced');
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

async function restoreSession(): Promise<void> {
  try {
    const response = await fetch('/api/v1/auth/me');
    const payload = (await response.json()) as { user?: User };
    if (response.ok && payload.user) user.value = payload.user;
  } catch {
    // Offline or unavailable: fall back to the login screen.
  } finally {
    sessionChecked.value = true;
  }
}

onMounted(() => {
  window.addEventListener('online', updateNetworkState);
  window.addEventListener('offline', updateNetworkState);
  void restoreSession();
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
    const payload = (await response.json()) as {
      user?: User;
      error?: { message?: string; details?: Array<{ message: string }> };
    };
    if (!response.ok || !payload.user) {
      message.value = payload.error?.details?.length
        ? payload.error.details.map((detail) => detail.message).join(' ')
        : (payload.error?.message ?? 'The request could not be completed.');
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

// Clears everything the previous user saw, so a shared device does not leak progress.
function resetUserState(): void {
  view.value = 'practice';
  direction.value = 'random';
  question.value = null;
  practiceSession.value = null;
  sessionSummary.value = null;
  answered.value = false;
  practiceMessage.value = '';
  dashboard.value = null;
  settingsMessage.value = '';
  adminPreview.value = null;
  adminHistory.value = [];
  adminMessage.value = '';
}

async function logout(): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
  } finally {
    user.value = null;
    mode.value = 'login';
    resetUserState();
  }
}

async function startPractice(): Promise<void> {
  practiceLoading.value = true;
  practiceMessage.value = '';
  question.value = null;
  sessionSummary.value = null;
  try {
    const response = await fetch('/api/v1/practice/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: direction.value }),
    });
    const payload = (await response.json()) as {
      session?: PracticeSession;
      error?: { message?: string };
    };
    if (!response.ok || !payload.session) {
      practiceMessage.value = payload.error?.message ?? 'Practice could not be started.';
      return;
    }
    practiceSession.value = payload.session;
  } catch {
    practiceMessage.value = 'The practice service is unavailable.';
    return;
  } finally {
    practiceLoading.value = false;
  }
  await loadQuestion();
}

async function loadQuestion(): Promise<void> {
  practiceLoading.value = true;
  practiceMessage.value = '';
  answered.value = false;
  try {
    const query = practiceSession.value
      ? `practiceSessionId=${encodeURIComponent(practiceSession.value.id)}`
      : `direction=${direction.value}`;
    const response = await fetch(`/api/v1/practice/question?${query}`);
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
  await nextTick();
  answerInput.value?.focus();
}

async function submitAnswer(): Promise<void> {
  if (!question.value || answered.value || practiceLoading.value) return;
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
        practiceSessionId: practiceSession.value?.id,
      }),
    });
    const payload = (await response.json()) as {
      result?: { correct: boolean; scoreDelta: number; correctAnswer: string };
      session?: { answeredCount: number; questionCount: number };
      error?: { message?: string };
    };
    if (!response.ok || !payload.result) {
      practiceMessage.value = payload.error?.message ?? 'The answer could not be submitted.';
      return;
    }
    answered.value = true;
    if (practiceSession.value && payload.session) {
      practiceSession.value.answeredCount = payload.session.answeredCount;
    }
    practiceMessage.value = payload.result.correct
      ? `Correct. +${payload.result.scoreDelta} points.`
      : `Not quite. The answer is ${payload.result.correctAnswer}.`;
  } catch {
    practiceMessage.value = 'The answer could not be submitted.';
  } finally {
    practiceLoading.value = false;
  }
  if (answered.value) {
    await nextTick();
    nextButton.value?.focus();
  }
}

function sessionIsFull(): boolean {
  return (
    !!practiceSession.value &&
    practiceSession.value.answeredCount >= practiceSession.value.questionCount
  );
}

async function nextQuestion(): Promise<void> {
  if (sessionIsFull()) {
    await endSession();
    return;
  }
  await loadQuestion();
}

async function endSession(): Promise<void> {
  if (!practiceSession.value) return;
  practiceLoading.value = true;
  practiceMessage.value = '';
  try {
    const response = await fetch(`/api/v1/practice/sessions/${practiceSession.value.id}/end`, {
      method: 'POST',
    });
    const payload = (await response.json()) as {
      session?: SessionSummary;
      error?: { message?: string };
    };
    if (!response.ok || !payload.session) {
      practiceMessage.value = payload.error?.message ?? 'The session could not be ended.';
      return;
    }
    sessionSummary.value = payload.session;
    practiceSession.value = null;
    question.value = null;
  } catch {
    practiceMessage.value = 'The session could not be ended.';
  } finally {
    practiceLoading.value = false;
  }
  if (sessionSummary.value) {
    await nextTick();
    summaryHeading.value?.focus();
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
    adminMessage.value = '';
    await loadImportHistory();
    return;
  }
  if (nextView !== 'settings' || settingsLoading.value) return;
  settingsLoading.value = true;
  settingsMessage.value = '';
  try {
    const response = await fetch('/api/v1/settings');
    const payload = (await response.json()) as {
      settings?: {
        direction?: string;
        sessionLength?: number;
        repetitionPreference?: 'balanced' | 'errors-first';
      };
    };
    if (response.ok && payload.settings) {
      if (payload.settings.direction) direction.value = payload.settings.direction;
      if (payload.settings.sessionLength) sessionLength.value = payload.settings.sessionLength;
      if (payload.settings.repetitionPreference) {
        repetitionPreference.value = payload.settings.repetitionPreference;
      }
    }
  } catch {
    settingsMessage.value = 'Settings could not be loaded.';
  } finally {
    settingsLoading.value = false;
  }
}

async function loadImportHistory(): Promise<void> {
  adminLoading.value = true;
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
    adminPreview.value = null;
    adminContent.value = '';
    await loadImportHistory();
    adminMessage.value = 'Import committed successfully.';
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
        sessionLength: sessionLength.value,
        repetitionPreference: repetitionPreference.value,
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
    <p v-if="!sessionChecked" class="panel muted" role="status">Checking your session...</p>
    <section v-else-if="!user" class="panel" aria-labelledby="page-title">
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
        <div v-if="sessionSummary" class="session-summary" aria-labelledby="summary-title">
          <h2 id="summary-title" ref="summaryHeading" tabindex="-1">
            {{
              sessionSummary.status === 'completed' ? 'Session complete.' : 'Session ended early.'
            }}
          </h2>
          <p v-if="sessionSummary.answeredCount === 0" class="muted">
            No questions were answered in this session.
          </p>
          <template v-else>
            <p v-if="sessionSummary.status !== 'completed'" class="muted">
              You answered {{ sessionSummary.answeredCount }} of
              {{ sessionSummary.questionCount }} questions.
            </p>
            <div class="stat-grid">
              <div class="stat" data-testid="summary-questions">
                <strong>{{ sessionSummary.answeredCount }}</strong
                ><span>questions</span>
              </div>
              <div class="stat" data-testid="summary-correct">
                <strong>{{ sessionSummary.correctCount }}</strong
                ><span>correct</span>
              </div>
              <div class="stat" data-testid="summary-incorrect">
                <strong>{{ sessionSummary.incorrectCount }}</strong
                ><span>incorrect</span>
              </div>
              <div class="stat" data-testid="summary-points">
                <strong>{{ sessionSummary.pointsEarned }}</strong
                ><span>points earned</span>
              </div>
              <div class="stat" data-testid="summary-accuracy">
                <strong>{{ Math.round(sessionSummary.accuracy * 100) }}%</strong
                ><span>accuracy</span>
              </div>
            </div>
            <template v-if="sessionSummary.wordsToPractice.length">
              <h3>Words to practice again</h3>
              <ul class="history-list" aria-label="Words to practice again">
                <li v-for="word in sessionSummary.wordsToPractice" :key="word">{{ word }}</li>
              </ul>
            </template>
            <p v-else class="muted">Every answer was correct. No words need extra practice.</p>
          </template>
          <div class="button-row">
            <button type="button" :disabled="practiceLoading" @click="startPractice">
              Practice again
            </button>
            <button class="text-button" type="button" @click="selectView('progress')">
              Go to progress
            </button>
          </div>
        </div>
        <template v-else-if="!practiceSession">
          <label for="direction">Practice direction</label>
          <select id="direction" v-model="direction">
            <option value="random">Random direction</option>
            <option value="english-to-german">English to German</option>
            <option value="german-to-english">German to English</option>
          </select>
          <button type="button" :disabled="practiceLoading" @click="startPractice">
            {{ practiceLoading ? 'Loading...' : 'Start practice' }}
          </button>
        </template>
        <template v-else>
          <p class="muted" data-testid="session-progress">
            Question
            {{
              Math.min(
                practiceSession.answeredCount + (answered ? 0 : 1),
                practiceSession.questionCount,
              )
            }}
            of {{ practiceSession.questionCount }}
          </p>
          <form v-if="question" class="practice-card" @submit.prevent="submitAnswer">
            <p class="prompt" data-testid="practice-prompt">{{ question.prompt }}</p>
            <p v-if="question.phonetics" class="muted">{{ question.phonetics }}</p>
            <label for="answer">Your answer</label>
            <input
              id="answer"
              ref="answerInput"
              v-model="submittedAnswer"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              :readonly="answered"
            />
            <button v-if="!answered" type="submit" :disabled="practiceLoading">
              {{ practiceLoading ? 'Checking...' : 'Submit answer' }}
            </button>
          </form>
          <div class="button-row">
            <button
              v-if="answered"
              ref="nextButton"
              type="button"
              :disabled="practiceLoading"
              @click="nextQuestion"
            >
              {{ sessionIsFull() ? 'See results' : 'Next question' }}
            </button>
            <button
              class="text-button"
              type="button"
              :disabled="practiceLoading"
              @click="endSession"
            >
              End session
            </button>
          </div>
        </template>
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
          <div class="stat" data-testid="stat-points">
            <strong>{{ dashboard.totalPoints }}</strong
            ><span>points</span>
          </div>
          <div class="stat" data-testid="stat-attempts">
            <strong>{{ dashboard.totalAttempts }}</strong
            ><span>attempts</span>
          </div>
          <div class="stat" data-testid="stat-accuracy">
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
        <fieldset class="plain-fieldset" :disabled="settingsLoading">
          <legend class="visually-hidden">Practice preferences</legend>
          <label for="settings-direction">Default direction</label>
          <select id="settings-direction" v-model="direction">
            <option value="random">Random direction</option>
            <option value="english-to-german">English to German</option>
            <option value="german-to-english">German to English</option>
          </select>
          <label for="settings-session-length">Questions per session</label>
          <input
            id="settings-session-length"
            v-model.number="sessionLength"
            type="number"
            inputmode="numeric"
            min="1"
            max="100"
            required
          />
          <button type="button" @click="saveSettings">
            {{ settingsLoading ? 'Working...' : 'Save settings' }}
          </button>
        </fieldset>
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
        <ul v-else-if="adminHistory.length" class="history-list" aria-label="Import history">
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
