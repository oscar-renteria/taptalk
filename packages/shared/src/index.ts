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

export type Registration = z.infer<typeof registrationSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type VocabularyImportRecord = z.infer<typeof vocabularyImportRecordSchema>;
export type PracticeDirection = z.infer<typeof practiceDirectionSchema>;
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export type AttemptResult = z.infer<typeof attemptResultSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
