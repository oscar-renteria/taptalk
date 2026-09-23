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

export const dashboardSummarySchema = z.object({
  totalPoints: z.number().finite(),
  totalAttempts: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  recentActivity: z.array(
    z.object({
      attemptedAt: z.string().datetime(),
      direction: z.enum(['english-to-german', 'german-to-english']),
      correct: z.boolean(),
    }),
  ),
  repeatedErrorWords: z.array(z.string().min(1)),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type VocabularyImportRecord = z.infer<typeof vocabularyImportRecordSchema>;
export type PracticeDirection = z.infer<typeof practiceDirectionSchema>;
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export type AttemptResult = z.infer<typeof attemptResultSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
