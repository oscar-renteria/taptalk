import { z } from 'zod';

export const projectName = 'TapTalk';

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

export const userRoleSchema = z.enum(['user', 'administrator']);

export const publicUserSchema = z
  .object({
    id: z.string().min(1),
    username: z.string().min(1),
    role: userRoleSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

// Credential policy: see docs/decisions/ADR-006-credential-policy.md.
export const usernameRules = { minLength: 2, maxLength: 32 } as const;
export const passwordRules = { minLength: 8, maxLength: 128 } as const;

const commonPasswords = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  '11111111',
  '00000000',
  'password',
  'passwort',
  'password1',
  'qwertyui',
  'qwertzui',
  'abcdefgh',
  'iloveyou',
  'taptalk1',
]);

export const usernameSchema = z
  .string()
  .trim()
  .min(usernameRules.minLength, `Username must be at least ${usernameRules.minLength} characters.`)
  .max(usernameRules.maxLength, `Username must be at most ${usernameRules.maxLength} characters.`)
  .regex(
    /^[\p{L}\p{N}._-]+$/u,
    'Username may only contain letters, numbers, dots, hyphens, and underscores.',
  );

export const passwordSchema = z
  .string()
  .min(passwordRules.minLength, `Password must be at least ${passwordRules.minLength} characters.`)
  .max(passwordRules.maxLength, `Password must be at most ${passwordRules.maxLength} characters.`)
  .refine((password) => !commonPasswords.has(password.toLowerCase()), {
    message: 'Password is too common. Choose a less predictable password.',
  })
  .refine((password) => new Set(password).size >= 4, {
    message: 'Password needs at least 4 different characters.',
  });

export const registrationSchema = z
  .object({ username: usernameSchema, password: passwordSchema })
  .refine(({ username, password }) => !password.toLowerCase().includes(username.toLowerCase()), {
    message: 'Password must not contain the username.',
    path: ['password'],
  });

export type FieldError = { field: string; message: string };

export function registrationErrors(input: unknown): FieldError[] {
  const parsed = registrationSchema.safeParse(input);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        field: String(issue.path[0] ?? 'form'),
        message: issue.message,
      }));
}

export const vocabularyImportRecordSchema = z.object({
  english: z.string().min(1),
  phonetics: z.string().optional(),
  german: z.string().min(1),
});

export const practiceDirectionSchema = z.enum(['english-to-german', 'german-to-english', 'random']);

export const repetitionPreferenceSchema = z.enum(['balanced', 'errors-first']);

export const userPreferencesSchema = z.object({
  direction: practiceDirectionSchema,
  sessionLength: z.number().int().min(1).max(100),
  repetitionPreference: repetitionPreferenceSchema,
});

export const attemptResultSchema = z.object({
  attemptId: z.string().min(1),
  correct: z.boolean(),
  scoreDelta: z.number().finite(),
  matchingReason: z.string().min(1),
});

/**
 * Which vocabulary entries a user has switched off for Practice Mode.
 *
 * Only excluded ids are sent, so an empty array means "practise everything".
 * Ids are the stable `vocabulary_entries.id` primary key, never the displayed
 * word, so two entries sharing a word cannot collide.
 */
export const practiceVocabularyExclusionsSchema = z.object({
  disabledIds: z.array(z.string().min(1).max(64)).max(5_000),
});

/** One row of the Settings vocabulary list. */
export const practiceVocabularyEntrySchema = z.object({
  id: z.string().min(1),
  english: z.string().min(1),
  german: z.string().min(1),
  enabled: z.boolean(),
});

export const practiceVocabularySchema = z.object({
  entries: z.array(practiceVocabularyEntrySchema),
});

// --- Exam Mode ---------------------------------------------------------------
// An exam is a practice session with kind = 'exam', so it reuses the same
// question selection and answer matching. Only the feedback model differs.

/**
 * The exam lengths the product offers. Fixed, and deliberately separate from the
 * Practice "questions per session" setting: an exam is a fixed-length test, not
 * a practice round, and coupling the two would let a practice preference change
 * the exam a learner thought they had started.
 */
export const examLengths = [5, 10, 20] as const;

export const defaultExamLength = 10;

export const examLengthSchema = z.union([
  z.literal(examLengths[0]),
  z.literal(examLengths[1]),
  z.literal(examLengths[2]),
]);

/**
 * The configuration an exam is built from.
 *
 * Intentionally a small, closed shape. New options can be added here without
 * touching the exam's core architecture, which is the point of naming it.
 */
export const examConfigurationSchema = z.object({
  /** The length the learner asked for, before the pool is taken into account. */
  questionCount: examLengthSchema,
  languageDirection: practiceDirectionSchema,
});

/**
 * What the exam returns while it is still running: position only.
 *
 * There is deliberately no `correct` field, no answer, and no score. The
 * evaluation is the server's business until the exam ends, so the client has
 * nothing to leak — in the DOM, in an accessibility label, or in the network
 * response.
 */
export const examAnswerProgressSchema = z.object({
  answeredCount: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
  /** True once the final answer is in, which is the first moment results exist. */
  complete: z.boolean(),
});

/**
 * The direction a single question was asked in.
 *
 * Narrower than `practiceDirectionSchema`: a session may be 'random', but by the
 * time a question exists the direction for that one question has been resolved.
 */
export const attemptDirectionSchema = z.enum(['english-to-german', 'german-to-english']);
export type AttemptDirection = z.infer<typeof attemptDirectionSchema>;

/** One answered question, shown only after the exam has been completed. */
export const examQuestionResultSchema = z.object({
  index: z.number().int().positive(),
  vocabularyEntryId: z.string().min(1),
  prompt: z.string().min(1),
  direction: attemptDirectionSchema,
  submittedAnswer: z.string(),
  correctAnswer: z.string().min(1),
  correct: z.boolean(),
});

/** The full result, available only once the exam is no longer active. */
export const examResultSchema = z.object({
  id: z.string().min(1),
  direction: z.enum(['english-to-german', 'german-to-english', 'random']),
  status: z.enum(['completed', 'abandoned']),
  totalQuestions: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  incorrectCount: z.number().int().nonnegative(),
  /** Percentage, 0-100, rounded to a whole number so it is deterministic. */
  score: z.number().min(0).max(100),
  durationSeconds: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  questions: z.array(examQuestionResultSchema),
});

/** One row of the exam history list. */
export const examHistoryEntrySchema = z.object({
  id: z.string().min(1),
  score: z.number().min(0).max(100),
  correctCount: z.number().int().nonnegative(),
  totalQuestions: z.number().int().nonnegative(),
  endedAt: z.string().datetime(),
});

/**
 * Aggregates are computed on the server so the Progress page never downloads the
 * whole history to average it.
 */
export const examStatisticsSchema = z.object({
  examsCompleted: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(100),
  bestScore: z.number().min(0).max(100),
  latestScore: z.number().min(0).max(100),
  totalQuestionsAnswered: z.number().int().nonnegative(),
  /** Oldest first, for the score-over-time view. */
  scoreHistory: z.array(z.number().min(0).max(100)),
});

export const dashboardSummarySchema = z.object({
  totalPoints: z.number().finite(),
  totalAttempts: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  recentActivity: z.array(
    z.object({
      attemptedAt: z.string().datetime(),
      direction: attemptDirectionSchema,
      correct: z.boolean(),
    }),
  ),
  repeatedErrorWords: z.array(z.string().min(1)),
});

// --- Share results & referral links --------------------------------------------
//
// The public share payload is the ONLY representation of a result that ever
// leaves the owner's session. It is deliberately built from a strict allow-list
// of scalars: no user id, username, class, per-word answers, or history. The
// `.strict()` object below makes an accidental extra field a validation failure
// rather than a silent privacy leak if a future handler returns too much.

/** The sanitized, publicly visible representation of one completed result. */
export const shareResultPayloadSchema = z
  .object({
    kind: z.enum(['practice', 'exam']),
    direction: practiceDirectionSchema,
    correctCount: z.number().int().nonnegative(),
    totalQuestions: z.number().int().nonnegative(),
    score: z.number().int().min(0).max(100),
    sharedAt: z.string().datetime(),
  })
  .strict();

export type ShareResultPayload = z.infer<typeof shareResultPayloadSchema>;

/**
 * Create-share input. Only the session id is accepted: the score, counts, and
 * direction are derived by the API from persisted results, never from the
 * client. The strict length bound keeps an arbitrary string from reaching a
 * query, and `.strict()` rejects a payload that also tries to send a score.
 */
export const createShareResultSchema = z.object({ sessionId: z.string().min(1).max(64) }).strict();

/** One entry in the owner's list of shares (includes the owner's own token). */
export const sharedResultListItemSchema = shareResultPayloadSchema.extend({
  id: z.string().min(1),
  token: z.string().min(1),
  path: z.string().startsWith('/share/'),
  revoked: z.boolean(),
});

export type SharedResultListItem = z.infer<typeof sharedResultListItemSchema>;

/**
 * How many people a share brought in. Acquisition metadata only: a count and a
 * converted count, never the referred learner's identity.
 */
export const shareReferralStatsSchema = z
  .object({
    sharedResultId: z.string().min(1),
    signups: z.number().int().nonnegative(),
    startedPracticing: z.number().int().nonnegative(),
  })
  .strict();

export type ShareReferralStats = z.infer<typeof shareReferralStatsSchema>;

// --- Custom vocabulary groups -----------------------------------------------
//
// A group is a vocabulary *scope*: a named, user-owned selection of existing
// vocabulary entries. It stores references, never a copy, so attempts and
// weighting stay attached to the original entry.

export const groupNameRules = { minLength: 1, maxLength: 80 } as const;

/**
 * Group names are user-generated. Surrounding whitespace is trimmed and an empty
 * result is rejected, so "   " is not a usable name. Not unique: a learner may
 * reuse a name, and different learners may pick the same one.
 */
export const vocabularyGroupNameSchema = z
  .string()
  .trim()
  .min(groupNameRules.minLength, 'Group name is required.')
  .max(
    groupNameRules.maxLength,
    `Group name must be at most ${groupNameRules.maxLength} characters.`,
  );

export const createVocabularyGroupSchema = z
  .object({ name: vocabularyGroupNameSchema })
  // The owner always comes from the session, so a browser-supplied owner is refused
  // rather than ignored.
  .strict();

export const renameVocabularyGroupSchema = z.object({ name: vocabularyGroupNameSchema }).strict();

/** Replace the membership of a group with exactly the listed vocabulary ids. */
export const setVocabularyGroupEntriesSchema = z
  .object({
    vocabularyEntryIds: z.array(z.string().min(1).max(64)).max(2000),
  })
  .strict();

/**
 * Choosing a vocabulary scope when starting a session or exam.
 *
 * `groupId` absent or null means all available vocabulary, which is the existing
 * behaviour. The browser may only name a scope; it may never send vocabulary ids,
 * because the API resolves membership itself.
 *
 * Deliberately not `.strict()`: this schema is read from the same request body as
 * `direction` and `questionCount`, which have their own schemas. Strictness that
 * actually matters -- never accepting a browser-supplied owner -- lives on
 * `createVocabularyGroupSchema`.
 */
export const vocabularyScopeSchema = z.object({
  groupId: z.string().min(1).max(64).nullable().optional(),
});

export const vocabularyGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  selectedCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** One row of the group editor: the vocabulary entry plus its membership state. */
export const vocabularyGroupEntrySchema = z.object({
  vocabularyEntryId: z.string().min(1),
  english: z.string().min(1),
  german: z.string().min(1),
  selected: z.boolean(),
});

export const vocabularyGroupDetailSchema = z.object({
  group: vocabularyGroupSchema,
  entries: z.array(vocabularyGroupEntrySchema),
});

export type VocabularyGroup = z.infer<typeof vocabularyGroupSchema>;
export type VocabularyGroupEntry = z.infer<typeof vocabularyGroupEntrySchema>;
export type VocabularyGroupDetail = z.infer<typeof vocabularyGroupDetailSchema>;

export type Registration = z.infer<typeof registrationSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type VocabularyImportRecord = z.infer<typeof vocabularyImportRecordSchema>;
export type PracticeDirection = z.infer<typeof practiceDirectionSchema>;
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export type AttemptResult = z.infer<typeof attemptResultSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type PracticeVocabularyExclusions = z.infer<typeof practiceVocabularyExclusionsSchema>;
export type PracticeVocabularyEntry = z.infer<typeof practiceVocabularyEntrySchema>;
export type PracticeVocabulary = z.infer<typeof practiceVocabularySchema>;
export type ExamLength = z.infer<typeof examLengthSchema>;
export type ExamConfiguration = z.infer<typeof examConfigurationSchema>;
export type ExamAnswerProgress = z.infer<typeof examAnswerProgressSchema>;
export type ExamQuestionResult = z.infer<typeof examQuestionResultSchema>;
export type ExamResult = z.infer<typeof examResultSchema>;
export type ExamHistoryEntry = z.infer<typeof examHistoryEntrySchema>;
export type ExamStatistics = z.infer<typeof examStatisticsSchema>;
