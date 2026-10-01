import { describe, expect, it } from 'vitest';
import type { ShareResultPayload } from '@taptalk/shared';
import {
  directionLabel,
  drawShareCard,
  shareCardFilename,
  shareCardSize,
  type CardContext,
  type ShareCardStrings,
} from './share-card';

const strings: ShareCardStrings = {
  appName: 'TapTalk',
  practice: 'Practice',
  exam: 'Exam',
  beatMyScore: 'Can you beat my score?',
  tryTapTalk: 'Try TapTalk',
  englishToGerman: 'English → German',
  germanToEnglish: 'German → English',
  mixed: 'Mixed directions',
};

const payload: ShareResultPayload = {
  kind: 'exam',
  direction: 'english-to-german',
  correctCount: 18,
  totalQuestions: 20,
  score: 90,
  sharedAt: '2026-01-01T00:00:00.000Z',
};

/** Records every drawing call so assertions can run without a real canvas. */
function recordingContext() {
  const texts: string[] = [];
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: () => {},
    fillText: (text: string) => texts.push(text),
    measureText: (text: string) => ({ width: text.length * 10 }) as TextMetrics,
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arcTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
  };
  return { context: context as unknown as CardContext, texts };
}

describe('share card renderer', () => {
  it('draws the API score and never recalculates it', () => {
    const { context, texts } = recordingContext();
    drawShareCard(context, payload, strings, { locale: 'en', url: 'https://taptalk.test/share/x' });
    // The ratio comes straight from the payload; the renderer has no answers to
    // recompute it from.
    expect(texts).toContain('18 / 20');
    expect(texts).toContain('90%');
  });

  it('labels the direction from the payload', () => {
    const { context, texts } = recordingContext();
    drawShareCard(context, payload, strings);
    expect(texts).toContain('English → German');

    const other = recordingContext();
    drawShareCard(other.context, { ...payload, direction: 'german-to-english' }, strings);
    expect(other.texts).toContain('German → English');

    const mixed = recordingContext();
    drawShareCard(mixed.context, { ...payload, direction: 'random' }, strings);
    expect(mixed.texts).toContain('Mixed directions');
  });

  it('names the result type in text, not colour alone', () => {
    const exam = recordingContext();
    drawShareCard(exam.context, payload, strings);
    expect(exam.texts).toContain('Exam');

    const practice = recordingContext();
    drawShareCard(practice.context, { ...payload, kind: 'practice' }, strings);
    expect(practice.texts).toContain('Practice');
  });

  it('renders using the caller’s translations, not English literals', () => {
    const { context, texts } = recordingContext();
    drawShareCard(context, payload, {
      ...strings,
      appName: 'TapTalk',
      exam: 'Prüfung',
      beatMyScore: 'Kannst du meinen Punktestand schlagen?',
    });
    expect(texts).toContain('Prüfung');
    expect(texts).toContain('Kannst du meinen Punktestand schlagen?');
    expect(texts).not.toContain('Exam');
  });

  it('includes a tick so a good score is not signalled by colour alone', () => {
    const { context, texts } = recordingContext();
    drawShareCard(context, payload, strings);
    expect(texts).toContain('✓');
  });

  it('formats numbers for the active locale', () => {
    const { context, texts } = recordingContext();
    drawShareCard(context, { ...payload, correctCount: 1234, totalQuestions: 2000 }, strings, {
      locale: 'de',
    });
    expect(texts).toContain('1.234 / 2.000');

    const english = recordingContext();
    drawShareCard(
      english.context,
      { ...payload, correctCount: 1234, totalQuestions: 2000 },
      strings,
      { locale: 'en' },
    );
    expect(english.texts).toContain('1,234 / 2,000');
  });

  it('omits the URL when there is none', () => {
    const withUrl = recordingContext();
    drawShareCard(withUrl.context, payload, strings, { url: 'https://taptalk.test/share/abc' });
    expect(withUrl.texts).toContain('https://taptalk.test/share/abc');

    const without = recordingContext();
    drawShareCard(without.context, payload, strings);
    expect(without.texts.some((t) => t.startsWith('https://'))).toBe(false);
  });

  it('draws nothing that could be an external resource', () => {
    const { context } = recordingContext();
    // A plain fill/stroke/text pipeline only: no image, no external font, no
    // remote reference that could beacon out.
    expect(Object.keys(context).sort()).toEqual([
      'arcTo',
      'beginPath',
      'closePath',
      'fill',
      'fillRect',
      'fillStyle',
      'fillText',
      'font',
      'lineTo',
      'lineWidth',
      'measureText',
      'moveTo',
      'restore',
      'save',
      'stroke',
      'strokeStyle',
      'textAlign',
      'textBaseline',
    ]);
  });

  it('uses a portrait size suited to chat previews', () => {
    expect(shareCardSize.width).toBe(1080);
    expect(shareCardSize.height).toBe(1350);
  });

  it('builds a safe filename', () => {
    expect(shareCardFilename(payload)).toBe('taptalk-exam-90.png');
    expect(shareCardFilename({ ...payload, kind: 'practice', score: 0 })).toBe(
      'taptalk-practice-0.png',
    );
  });

  it('maps directions to labels', () => {
    expect(directionLabel('english-to-german', strings)).toBe('English → German');
    expect(directionLabel('german-to-english', strings)).toBe('German → English');
    expect(directionLabel('random', strings)).toBe('Mixed directions');
  });
});
