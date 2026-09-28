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
export type Position = 'top' | 'middle' | 'bottom';
export type TextSize = 'S' | 'M' | 'L';
export type ThemeId = 'dark' | 'light' | 'festive';

export const THEMES: Record<
  ThemeId,
  { label: string; band: string; text: string }
> = {
  dark: { label: 'Dark', band: 'rgba(0,0,0,0.62)', text: '#FFFFFF' },
  light: { label: 'Light', band: 'rgba(255,255,255,0.85)', text: '#1A1A1A' },
  festive: { label: 'Festive', band: 'rgba(196,30,58,0.88)', text: '#FFD54F' },
};

// Font size as a fraction of output width, so S/M/L look the same on any image.
const SIZE_RATIO: Record<TextSize, number> = { S: 0.05, M: 0.068, L: 0.088 };
const MIN_SIZE_RATIO = 0.036; // below this, text is unreadable on a phone feed
const MAX_TEXT_HEIGHT_RATIO = 0.42; // text never covers more than ~40% of the photo
const MARGIN_RATIO = 0.06; // safe margin from the edges
const PAD_RATIO = 0.03; // padding inside the band

// Instagram's upload limit is ~1440px wide, but we keep the source resolution
// and only cap at a size every phone GPU can render in one texture.
const MAX_SIDE = 4096;

const FONT_FAMILIES = ['NotoSans', 'NotoSansDevanagari', 'NotoColorEmoji'];

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

export interface TextLayout {
  paragraph: SkParagraph;
  fontSize: number;
  textX: number;
  textY: number;
  textWidth: number;
  band: { x: number; y: number; width: number; height: number; r: number };
  shrunk: boolean; // had to go below the chosen size
  truncated: boolean; // even the minimum size didn't fit, text was cut with …
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

export function layoutText(
  text: string,
  width: number,
  height: number,
  position: Position,
  size: TextSize,
  themeId: ThemeId,
  fonts: SkTypefaceFontProvider,
): TextLayout {
  const color = THEMES[themeId].text;
  const margin = width * MARGIN_RATIO;
  const pad = width * PAD_RATIO;
  const textWidth = width - 2 * margin - 2 * pad;
  const maxTextHeight = height * MAX_TEXT_HEIGHT_RATIO;

  // 1. Try the owner's size, then shrink step by step down to the minimum.
  const start = width * SIZE_RATIO[size];
  const min = width * MIN_SIZE_RATIO;
  let fontSize = start;
  let paragraph = buildParagraph(text, fontSize, color, fonts);
  paragraph.layout(textWidth);
  while (paragraph.getHeight() > maxTextHeight && fontSize > min) {
    fontSize = Math.max(min, fontSize * 0.92);
    paragraph = buildParagraph(text, fontSize, color, fonts);
    paragraph.layout(textWidth);
  }

  // 2. Still too tall at the minimum size: cut to the lines that fit, add "…".
  let truncated = false;
  if (paragraph.getHeight() > maxTextHeight) {
    const lines = paragraph.getLineMetrics();
    const lineHeight = paragraph.getHeight() / Math.max(1, lines.length);
    const maxLines = Math.max(1, Math.floor(maxTextHeight / lineHeight));
    paragraph = buildParagraph(text, fontSize, color, fonts, maxLines);
    paragraph.layout(textWidth);
    truncated = true;
  }

  const textHeight = paragraph.getHeight();
  const bandHeight = textHeight + 2 * pad;
  const bandY =
    position === 'top'
      ? margin
      : position === 'bottom'
      ? height - margin - bandHeight
      : (height - bandHeight) / 2;

  return {
    paragraph,
    fontSize,
    textX: margin + pad,
    textY: bandY + pad,
    textWidth,
    band: {
      x: margin,
      y: bandY,
      width: width - 2 * margin,
      height: bandHeight,
      r: pad * 0.8,
    },
    shrunk: fontSize < start - 0.5,
    truncated,
  };
}
