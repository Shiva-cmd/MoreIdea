import React from 'react';
import {
  Group,
  Image,
  Paragraph,
  RoundedRect,
  vec,
  type SkImage,
} from '@shopify/react-native-skia';
import { THEMES, type TextLayout, type ThemeId } from './layout';

interface Props {
  image: SkImage;
  width: number;
  height: number;
  layout: TextLayout;
  theme: ThemeId;
  /** False for an empty caption: draw just the photo, no empty band. */
  showText: boolean;
}

/**
 * The finished post, drawn at output resolution. Used both inside the on-screen
 * <Canvas> (scaled down) and by drawAsImage() for the export, so the two can't
 * drift apart.
 */
export function Post({
  image,
  width,
  height,
  layout,
  theme,
  showText,
}: Props) {
  const { band } = layout;
  return (
    <Group>
      <Image
        image={image}
        x={0}
        y={0}
        width={width}
        height={height}
        fit="cover"
      />
      {showText && (
        <Group
          origin={vec(band.x + band.width / 2, band.y + band.height / 2)}
          transform={[{ rotate: layout.rotation }]}>
          <RoundedRect
            x={band.x}
            y={band.y}
            width={band.width}
            height={band.height}
            r={band.r}
            color={THEMES[theme].band}
          />
          <Paragraph
            paragraph={layout.paragraph}
            x={layout.textX}
            y={layout.textY}
            width={layout.textWidth}
          />
        </Group>
      )}
    </Group>
  );
}
