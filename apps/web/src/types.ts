export type Tone = 'info' | 'success' | 'warning' | 'error';
export type Role = 'user' | 'administrator';
export type User = { username: string; role: Role };
export type Direction = 'random' | 'english-to-german' | 'german-to-english';
export type ApiErrorBody = {
  error?: { code?: string; message?: string; details?: Array<{ field: string; message: string }> };
};

/** Direction values are stable API-facing identifiers; labels are localized by the view. */
export const directionValues = ['random', 'english-to-german', 'german-to-english'] as const;
