export type Tone = 'info' | 'success' | 'warning' | 'error';
export type Role = 'user' | 'administrator';
export type User = { username: string; role: Role };
export type Direction = 'random' | 'english-to-german' | 'german-to-english';
export type ApiErrorBody = {
  error?: { code?: string; message?: string; details?: Array<{ field: string; message: string }> };
};

export const directionOptions = [
  { value: 'random', label: 'Random direction' },
  { value: 'english-to-german', label: 'English to German' },
  { value: 'german-to-english', label: 'German to English' },
] as const;
