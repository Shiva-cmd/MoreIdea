import {
  FontWeight,
  Skia,
  TextAlign,
  type SkParagraph,
  type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';

// Everything here is in *output image pixels*. The preview just scales the
// same drawing down, so what the owner sees is exactly what gets exported.

export type Aspect = 'square' | 'portrait';
export type ThemeId = 'dark' | 'light' | 'festive';

export const THEMES: Record<
  ThemeId,
  { label: string; band: string; text: string }
> = {
  dark: { label: 'Dark', band: 'rgba(0,0,0,0.62)', text: '#FFFFFF' },
  light: { label: 'Light', band: 'rgba(255,255,255,0.85)', text: '#1A1A1A' },
  festive: { label: 'Festive', band: 'rgba(196,30,58,0.88)', text: '#FFD54F' },
};

// Font size is a fraction of output width, so it looks the same on any photo.
// Presets for the S/M/L buttons; pinch moves freely between MIN and MAX.
export const SIZE_PRESETS = { S: 0.05, M: 0.068, L: 0.088 } as const;
export const MIN_SIZE_RATIO = 0.036; // below this, unreadable in a phone feed
export const MAX_SIZE_RATIO = 0.14; // above this, a few words fill the photo

// Where the text sits: centre of the band as a fraction of the photo (0..1).
// Stored as fractions so switching 1:1 ↔ 4:5 keeps the text roughly in place.
export interface Placement {
  cx: number;
  cy: number;
}
export const POSITION_PRESETS = {
  top: { cx: 0.5, cy: 0 },
  middle: { cx: 0.5, cy: 0.5 },
  bottom: { cx: 0.5, cy: 1 },
} as const;

const MAX_TEXT_HEIGHT_RATIO = 0.42; // text never covers more than ~40% of the photo
const MARGIN_RATIO = 0.06; // safe margin from the edges
const PAD_RATIO = 0.03; // padding inside the band

// Instagram's upload limit is ~1440px wide, but we keep the source resolution
// and only cap at a size every phone GPU can render in one texture.
const MAX_SIDE = 4096;

// "Emoji" is Noto Color Emoji on Android and Apple Color Emoji on iOS (see
// useEmojiFonts in PostComposer).
const FONT_FAMILIES = ['NotoSans', 'NotoSansDevanagari', 'Emoji'];

export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** Centre-crop the source to the chosen aspect without upscaling. */
export function outputSize(srcW: number, srcH: number, aspect: Aspect) {
  const ratio = aspect === 'square' ? 1 : 4 / 5; // width / height
  let w = srcW;
  let h = srcH;
  if (srcW / srcH > ratio) {
    w = srcH * ratio;
  } else {
    h = srcW / ratio;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export interface TextBlock {
  paragraph: SkParagraph;
  textWidth: number;
  textHeight: number;
  pad: number;
  shrunk: boolean; // had to go below the chosen size
  truncated: boolean; // even the minimum size didn't fit, text was cut with …
}

export interface TextLayout extends TextBlock {
  textX: number;
  textY: number;
  band: { x: number; y: number; width: number; height: number; r: number };
  rotation: number; // radians, around the band's centre
}

const SNAP = (5 * Math.PI) / 180;

/** Snap to level (0/90/180/270°) when within 5°, so "straight" is easy to hit. */
export function snapRotation(angle: number) {
  const quarter = Math.PI / 2;
  const nearest = Math.round(angle / quarter) * quarter;
  return Math.abs(angle - nearest) < SNAP ? nearest : angle;
}

function buildParagraph(
  text: string,
  fontSize: number,
  color: string,
  fonts: SkTypefaceFontProvider,
  maxLines?: number,
) {
  const builder = Skia.ParagraphBuilder.Make(
    {
      textAlign: TextAlign.Center,
      maxLines,
      ellipsis: maxLines ? '…' : undefined,
    },
    fonts,
  );
  builder
    .pushStyle({
      color: Skia.Color(color),
      fontFamilies: FONT_FAMILIES,
      fontSize,
      fontStyle: { weight: FontWeight.Bold },
      heightMultiplier: 1.25,
    })
    .addText(text)
    .pop();
  return builder.build();
}

/**
 * Shape the caption at the requested size. Expensive-ish (text shaping), so
 * it's kept separate from placement, which changes on every drag frame.
 */
export function shapeText(
  text: string,
  width: number,
  height: number,
  sizeRatio: number,
  themeId: ThemeId,
  fonts: SkTypefaceFontProvider,
): TextBlock {
  const color = THEMES[themeId].text;
  const pad = width * PAD_RATIO;
  const maxWidth = width * (1 - 2 * MARGIN_RATIO) - 2 * pad;
  const maxHeight = height * MAX_TEXT_HEIGHT_RATIO;

  // 1. Try the owner's size, then shrink step by step down to the minimum.
  const start = width * clamp(sizeRatio, MIN_SIZE_RATIO, MAX_SIZE_RATIO);
  const min = width * MIN_SIZE_RATIO;
  let fontSize = start;
  let paragraph = buildParagraph(text, fontSize, color, fonts);
  paragraph.layout(maxWidth);
  while (paragraph.getHeight() > maxHeight && fontSize > min) {
    fontSize = Math.max(min, fontSize * 0.92);
    paragraph = buildParagraph(text, fontSize, color, fonts);
    paragraph.layout(maxWidth);
  }

  // 2. Still too tall at the minimum size: cut to the lines that fit, add "…".
  let truncated = false;
  if (paragraph.getHeight() > maxHeight) {
    const lines = paragraph.getLineMetrics();
    const lineHeight = paragraph.getHeight() / Math.max(1, lines.length);
    const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
    paragraph = buildParagraph(text, fontSize, color, fonts, maxLines);
    paragraph.layout(maxWidth);
    truncated = true;
  }

  // 3. Shrink-wrap: re-layout at the longest line so the band hugs the text
  //    (and can be moved sideways) while lines stay centred.
  const longest = Math.ceil(paragraph.getLongestLine()) + 1;
  const textWidth = Math.min(maxWidth, longest);
  paragraph.layout(textWidth);

  return {
    paragraph,
    textWidth,
    textHeight: paragraph.getHeight(),
    pad,
    shrunk: fontSize < start - 0.5,
    truncated,
  };
}

/**
 * Put the shaped text at the owner's spot and angle, never outside the safe
 * margins. Clamping uses the rotated band's bounding box, so tilted corners
 * can't poke off the photo either.
 */
export function placeText(
  block: TextBlock,
  width: number,
  height: number,
  { cx, cy }: Placement,
  rotation: number,
): TextLayout {
  const margin = width * MARGIN_RATIO;
  const { pad, textWidth, textHeight } = block;
  const bandW = textWidth + 2 * pad;
  const bandH = textHeight + 2 * pad;

  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const boxW = bandW * cos + bandH * sin;
  const boxH = bandW * sin + bandH * cos;
  const centre = (target: number, box: number, size: number) =>
    box > size - 2 * margin
      ? size / 2 // too big to fit inside the margins: keep it centred
      : clamp(target, margin + box / 2, size - margin - box / 2);
  const midX = centre(cx * width, boxW, width);
  const midY = centre(cy * height, boxH, height);

  const x = midX - bandW / 2;
  const y = midY - bandH / 2;
  return {
    ...block,
    textX: x + pad,
    textY: y + pad,
    band: { x, y, width: bandW, height: bandH, r: pad * 0.8 },
    rotation,
  };
}
