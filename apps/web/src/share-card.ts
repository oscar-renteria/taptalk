import type { PracticeDirection, ShareResultPayload } from '@taptalk/shared';

/**
 * Client-side renderer for the shareable result card.
 *
 * Drawn with the Canvas 2D API rather than added as a dependency: the card is a
 * fixed set of rounded rectangles and text, so a library would not remove any
 * real work, and the production CSP already forbids the remote script and image
 * sources such a library usually pulls in.
 *
 * The renderer receives only the API's sanitized `ShareResultPayload` plus
 * already-translated strings. It never derives a score from answers, never reads
 * the DOM, and never accepts caller-supplied markup, so nothing a learner types
 * can reach the image.
 *
 * `drawShareCard` is a pure function of its context and arguments, so the unit
 * tests exercise it against a recording stub instead of a real canvas.
 */

export type ShareCardStrings = {
  appName: string;
  practice: string;
  exam: string;
  beatMyScore: string;
  tryTapTalk: string;
  englishToGerman: string;
  germanToEnglish: string;
  mixed: string;
};

export const shareCardSize = { width: 1080, height: 1350 };

// Mirrors the palette in style.css. Canvas cannot read CSS custom properties, so
// the few colours the card needs are restated here and asserted against the
// tokens in share-card.test.ts.
const palette = {
  paper: '#fbf8f1',
  surface: '#fffdf7',
  ink: '#1f2a24',
  muted: '#5e665f',
  accent: '#b4533a',
  accentStrong: '#7e3322',
  line: '#e7e0d2',
  success: '#2f6b4f',
} as const;

const display = "'Newsreader Variable', Newsreader, Georgia, serif";
const ui = "'Instrument Sans Variable', 'Instrument Sans', system-ui, sans-serif";

/** Minimal 2D context surface, so the renderer can be tested without a canvas. */
export type CardContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'fillRect'
  | 'fillText'
  | 'measureText'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arcTo'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'save'
  | 'restore'
>;

/** Direction as it should read on a card; `random` is described as Mixed. */
export function directionLabel(direction: PracticeDirection, strings: ShareCardStrings): string {
  if (direction === 'english-to-german') return strings.englishToGerman;
  if (direction === 'german-to-english') return strings.germanToEnglish;
  return strings.mixed;
}

function roundRect(
  context: CardContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.arcTo(x + width, y, x + width, y + r, r);
  context.lineTo(x + width, y + height - r);
  context.arcTo(x + width, y + height, x + width - r, y + height, r);
  context.lineTo(x + r, y + height);
  context.arcTo(x, y + height, x, y + height - r, r);
  context.lineTo(x, y + r);
  context.arcTo(x, y, x + r, y, r);
  context.closePath();
}

/** Locale-aware integer formatting, so 1000 does not render as "1,000" in German. */
function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}
/**
 * Draw the card. `locale` is used only for number formatting; every other string
 * is passed in already translated by the caller.
 */
export function drawShareCard(
  context: CardContext,
  payload: ShareResultPayload,
  strings: ShareCardStrings,
  options: { locale?: string; url?: string } = {},
): void {
  const { width, height } = shareCardSize;
  const locale = options.locale ?? 'en';

  context.save();
  context.fillStyle = palette.paper;
  context.fillRect(0, 0, width, height);

  // The accent band reads as branding even at a glance in a chat list.
  context.fillStyle = palette.accent;
  context.fillRect(0, 0, width, 28);

  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';

  // Wordmark
  context.fillStyle = palette.accentStrong;
  context.font = `700 44px ${ui}`;
  context.fillText(strings.appName, width / 2, 132);

  // The card itself
  const cardX = 80;
  const cardY = 196;
  const cardW = width - cardX * 2;
  const cardH = 900;
  context.fillStyle = palette.surface;
  roundRect(context, cardX, cardY, cardW, cardH, 48);
  context.fill();
  context.strokeStyle = palette.line;
  context.lineWidth = 3;
  roundRect(context, cardX, cardY, cardW, cardH, 48);
  context.stroke();

  // Result type badge. Text, not colour alone, so it survives greyscale.
  const badgeText = payload.kind === 'exam' ? strings.exam : strings.practice;
  context.font = `600 34px ${ui}`;
  const badgeW = context.measureText(badgeText).width + 72;
  context.fillStyle = palette.paper;
  roundRect(context, width / 2 - badgeW / 2, cardY + 56, badgeW, 68, 34);
  context.fill();
  context.strokeStyle = palette.line;
  context.lineWidth = 2;
  roundRect(context, width / 2 - badgeW / 2, cardY + 56, badgeW, 68, 34);
  context.stroke();
  context.fillStyle = palette.muted;
  context.font = `600 34px ${ui}`;
  context.fillText(badgeText, width / 2, cardY + 102);

  // The score, large. This is the whole point of the card.
  context.fillStyle = palette.ink;
  context.font = `700 190px ${display}`;
  const ratio = formatNumber(payload.correctCount, locale);
  const total = formatNumber(payload.totalQuestions, locale);
  const scoreText = `${ratio} / ${total}`;
  context.fillText(scoreText, width / 2, cardY + 372);

  // Percentage, with a tick so a good result is not signalled by colour alone.
  const percent = `${formatNumber(payload.score, locale)}%`;
  context.font = `700 72px ${ui}`;
  context.fillStyle = palette.success;
  context.fillText(percent, width / 2, cardY + 486);
  const percentW = context.measureText(percent).width;
  context.fillText('✓', width / 2 - percentW / 2 - 46, cardY + 486);

  // Direction
  context.font = `500 44px ${ui}`;
  context.fillStyle = palette.muted;
  context.fillText(directionLabel(payload.direction, strings), width / 2, cardY + 578);

  // Divider
  context.fillStyle = palette.line;
  context.fillRect(cardX + 120, cardY + 636, cardW - 240, 2);

  // The invitation
  context.font = `600 50px ${display}`;
  context.fillStyle = palette.ink;
  context.fillText(strings.beatMyScore, width / 2, cardY + 730);

  context.font = `500 38px ${ui}`;
  context.fillStyle = palette.muted;
  context.fillText(strings.tryTapTalk, width / 2, cardY + 812);

  // The public link. Plain text, so it cannot become a tracking pixel or beacon.
  if (options.url) {
    context.font = `500 30px ${ui}`;
    context.fillText(options.url, width / 2, cardY + 870);
  }

  context.restore();
}

/**
 * Render the card to a PNG blob.
 *
 * `document.fonts.ready` is awaited first: the bundled faces load lazily, and a
 * card drawn before they arrive falls back to a system serif, which looks nothing
 * like the in-app preview.
 */
export async function renderShareCardBlob(
  payload: ShareResultPayload,
  strings: ShareCardStrings,
  options: { locale?: string; url?: string } = {},
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = shareCardSize.width;
  canvas.height = shareCardSize.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the result card.');
  await document.fonts?.ready;
  drawShareCard(context, payload, strings, options);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The result card could not be generated.'));
    }, 'image/png');
  });
}

/** A filename that is stable and safe on every platform. */
export function shareCardFilename(payload: ShareResultPayload): string {
  return `taptalk-${payload.kind}-${payload.score}.png`;
}
