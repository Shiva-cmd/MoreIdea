import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  GestureDetector,
  ScrollView,
  usePanGesture,
  usePinchGesture,
  useRotationGesture,
  useSimultaneousGestures,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Canvas,
  Group,
  Skia,
  drawAsImage,
  useFonts,
  useImage,
  type DataSourceParam,
} from '@shopify/react-native-skia';
import {
  launchCamera,
  launchImageLibrary,
  type ImagePickerResponse,
} from 'react-native-image-picker';
import {
  MAX_SIZE_RATIO,
  MIN_SIZE_RATIO,
  POSITION_PRESETS,
  SIZE_PRESETS,
  THEMES,
  clamp,
  outputSize,
  placeText,
  shapeText,
  snapRotation,
  type Aspect,
  type Placement,
  type ThemeId,
} from './layout';
import { Post } from './Post';
import { saveToGallery, shareToInstagram, writeJpeg } from './exportPost';

const SAMPLE_CAPTIONS = [
  { label: 'हिंदी', text: 'दिवाली धमाका! सभी मिठाइयों पर 20% छूट 🪔🎉' },
  { label: 'Emoji', text: 'Fresh samosas every morning 🥟☕ Come hungry! 😋' },
  {
    label: 'Too long',
    text:
      'शर्मा जनरल स्टोर में आपका स्वागत है! 🛒 इस हफ़्ते हर सामान पर भारी छूट — ' +
      'चावल, दाल, आटा, तेल, मसाले, बिस्कुट, नमकीन और भी बहुत कुछ। ' +
      'Free home delivery within 3 km 🚚 Open 8am–10pm, all 7 days. ' +
      'Call 98XXXXXX10 or just WhatsApp your list and we will pack it for you 🙏✨ ' +
      'त्योहारों के लिए खास गिफ्ट हैम्पर भी उपलब्ध हैं — ड्राई फ्रूट्स, मिठाई और पूजा का सामान। ' +
      'Pay by UPI, card or cash. Visit us today! 🎁🪔',
  },
];

const MIN_SOURCE_SIDE = 1080;

// The bundled Noto Color Emoji is a COLRv1 font. Android's Skia (FreeType)
// draws it, but iOS's Skia goes through CoreText, which can't, so emoji come
// out blank. On iOS we use the system's Apple Color Emoji instead.
const BUNDLED_FONTS = {
  NotoSans: [require('../assets/fonts/NotoSans-Bold.ttf')],
  NotoSansDevanagari: [require('../assets/fonts/NotoSansDevanagari-Bold.ttf')],
  ...(Platform.OS === 'ios'
    ? {}
    : { Emoji: [require('../assets/fonts/NotoColorEmoji.ttf')] }),
};

function useCaptionFonts() {
  const fonts = useFonts(BUNDLED_FONTS);
  return useMemo(() => {
    if (fonts && Platform.OS === 'ios') {
      const appleEmoji = Skia.FontMgr.System().matchFamilyStyle(
        'Apple Color Emoji',
        {},
      );
      if (appleEmoji) {
        fonts.registerFont(appleEmoji, 'Emoji');
      }
    }
    return fonts;
  }, [fonts]);
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'done'; message: string };

export function PostComposer() {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();

  const [source, setSource] = useState<DataSourceParam>(
    require('../assets/images/shop.jpg'),
  );
  const [caption, setCaption] = useState(SAMPLE_CAPTIONS[0].text);
  const [aspect, setAspect] = useState<Aspect>('square');
  const [placement, setPlacement] = useState<Placement>(
    POSITION_PRESETS.bottom,
  );
  const [sizeRatio, setSizeRatio] = useState<number>(SIZE_PRESETS.M);
  const [rotation, setRotation] = useState(0); // radians
  const [gesturing, setGesturing] = useState(false);
  const [theme, setTheme] = useState<ThemeId>('dark');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const image = useImage(source);
  const fonts = useCaptionFonts();

  const out = useMemo(
    () => (image ? outputSize(image.width(), image.height(), aspect) : null),
    [image, aspect],
  );

  // An empty caption posts just the photo: no text and no empty band.
  const hasText = caption.trim().length > 0;

  // Shaping only reruns when the text or size changes; dragging only re-places.
  const block = useMemo(() => {
    if (!out || !fonts) {
      return null;
    }
    const text = caption.trim() || ' ';
    return shapeText(text, out.width, out.height, sizeRatio, theme, fonts);
  }, [out, fonts, caption, sizeRatio, theme]);

  const layout = useMemo(
    () =>
      block && out
        ? placeText(block, out.width, out.height, placement, rotation)
        : null,
    [block, out, placement, rotation],
  );

  const previewW = screenW - 32;
  const previewH = out ? (previewW * out.height) / out.width : previewW;
  const scale = out ? previewW / out.width : 1;

  // Latest values for the gesture callbacks.
  const live = useRef({ layout, out, sizeRatio, rotation, previewW, previewH });
  live.current = { layout, out, sizeRatio, rotation, previewW, previewH };

  // Where the band actually is (after clamping to the margins), as 0..1.
  // Drags start from here rather than the stored target, so dragging back
  // from an edge responds at once.
  const bandCentre = () => {
    const { layout: l, out: o } = live.current;
    return l && o
      ? {
          cx: (l.band.x + l.band.width / 2) / o.width,
          cy: (l.band.y + l.band.height / 2) / o.height,
        }
      : { cx: 0.5, cy: 0.5 };
  };

  const drag = useRef({ cx: 0, cy: 0, tx: 0, ty: 0, pointers: 0 });
  const pinchStart = useRef(0);
  const rotateStart = useRef(0);

  // One or two fingers drag the text. When a finger is added or lifted the
  // pan's translation jumps, so re-baseline on every pointer-count change.
  const pan = usePanGesture({
    runOnJS: true,
    averageTouches: true,
    minDistance: 2,
    onBegin: () => setGesturing(true),
    onActivate: e => {
      drag.current = {
        ...bandCentre(),
        tx: e.translationX,
        ty: e.translationY,
        pointers: e.numberOfPointers,
      };
    },
    onUpdate: e => {
      if (e.numberOfPointers !== drag.current.pointers) {
        drag.current = {
          ...bandCentre(),
          tx: e.translationX,
          ty: e.translationY,
          pointers: e.numberOfPointers,
        };
        return;
      }
      const d = drag.current;
      const { previewW: w, previewH: h } = live.current;
      setPlacement({
        cx: clamp(d.cx + (e.translationX - d.tx) / w, 0, 1),
        cy: clamp(d.cy + (e.translationY - d.ty) / h, 0, 1),
      });
    },
    onFinalize: () => setGesturing(false),
  });

  // Two fingers pinch to resize, within the readable min/max.
  const pinch = usePinchGesture({
    runOnJS: true,
    onActivate: () => {
      pinchStart.current = live.current.sizeRatio;
    },
    onUpdate: e => {
      setSizeRatio(
        clamp(pinchStart.current * e.scale, MIN_SIZE_RATIO, MAX_SIZE_RATIO),
      );
    },
  });

  // Two fingers twist to rotate to any angle; it snaps level near 0/90/180/270°.
  const rotate = useRotationGesture({
    runOnJS: true,
    onActivate: () => {
      rotateStart.current = live.current.rotation;
    },
    onUpdate: e => {
      setRotation(snapRotation(rotateStart.current + e.rotation));
    },
  });

  // Drag, pinch and rotate all at once, like moving a sticker.
  const gestures = useSimultaneousGestures(pan, pinch, rotate);

  const lowRes =
    image && Math.min(image.width(), image.height()) < MIN_SOURCE_SIDE;

  const pickImage = async (from: 'gallery' | 'camera') => {
    // quality: 1 and no maxWidth/maxHeight keep the photo at full resolution.
    const options = { mediaType: 'photo', quality: 1 } as const;
    const res: ImagePickerResponse =
      from === 'camera'
        ? await launchCamera({ ...options, saveToPhotos: false })
        : await launchImageLibrary(options);
    if (res.errorCode === 'camera_unavailable') {
      // e.g. the iOS Simulator, which has no camera.
      Alert.alert(
        'No camera available',
        'This device has no camera. Pick a photo from the Gallery instead.',
      );
      return;
    }
    if (res.errorCode) {
      Alert.alert('Could not open ' + from, res.errorMessage ?? res.errorCode);
      return;
    }
    const uri = res.assets?.[0]?.uri;
    if (uri) {
      setSource(uri);
      setStatus({ kind: 'idle' });
    }
  };

  const render = async () => {
    if (!image || !out || !layout) {
      return null;
    }
    const snapshot = await drawAsImage(
      <Post
        image={image}
        width={out.width}
        height={out.height}
        layout={layout}
        theme={theme}
        showText={hasText}
      />,
      out,
    );
    if (!snapshot) {
      throw new Error('Could not render the image');
    }
    return writeJpeg(snapshot);
  };

  const run = async (label: string, action: (path: string) => Promise<string>) => {
    try {
      setStatus({ kind: 'busy', message: label });
      const path = await render();
      if (!path) {
        return;
      }
      setStatus({ kind: 'done', message: await action(path) });
    } catch (e) {
      setStatus({ kind: 'idle' });
      Alert.alert('Something went wrong', String((e as Error).message ?? e));
    }
  };

  const onSave = () =>
    run('Saving full-size image…', async path => {
      await saveToGallery(path);
      return `Saved ${out!.width}×${out!.height} JPEG to your gallery.`;
    });

  const onInstagram = () =>
    run('Preparing for Instagram…', async path => {
      const via = await shareToInstagram(path, caption);
      return via === 'instagram'
        ? 'Caption copied — in Instagram, long-press the caption box and Paste.'
        : 'Instagram not installed — opened the share sheet. Caption is copied.';
    });

  const busy = status.kind === 'busy';

  return (
    <ScrollView
      style={styles.screen}
      scrollEnabled={!gesturing}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Create post</Text>

      {/* Gesture Handler's ScrollView takes part in gesture arbitration, so the
          pan (which activates after 2pt) wins over page scrolling on the photo. */}
      <GestureDetector gesture={gestures}>
        <View style={[styles.preview, { width: previewW, height: previewH }]}>
          {image && out && layout ? (
            <Canvas style={{ width: previewW, height: previewH }}>
              <Group transform={[{ scale }]}>
                <Post
                  image={image}
                  width={out.width}
                  height={out.height}
                  layout={layout}
                  theme={theme}
                  showText={hasText}
                />
              </Group>
            </Canvas>
          ) : (
            <ActivityIndicator />
          )}
        </View>
      </GestureDetector>

      {out && (
        <Text style={styles.meta}>
          Output: {out.width}×{out.height}px
          {lowRes ? '  ⚠️ Photo is small, may look blurry on Instagram' : ''}
        </Text>
      )}
      <Text style={styles.hint}>
        Drag to move · pinch to resize · twist two fingers to rotate
      </Text>
      {layout?.truncated ? (
        <Text style={styles.warn}>
          Caption is too long for the photo, so it was shortened with “…”. The
          full text will still go in your Instagram caption.
        </Text>
      ) : layout?.shrunk ? (
        <Text style={styles.hint}>Text made smaller so it fits.</Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          style={[styles.secondaryBtn, styles.flex]}
          onPress={() => pickImage('gallery')}
          disabled={busy}>
          <Text style={styles.secondaryBtnText}>🖼️ Gallery</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryBtn, styles.flex]}
          onPress={() => pickImage('camera')}
          disabled={busy}>
          <Text style={styles.secondaryBtnText}>📷 Camera</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Caption</Text>
      <View style={styles.row}>
        {SAMPLE_CAPTIONS.map(c => (
          <Chip
            key={c.label}
            label={c.label}
            active={caption === c.text}
            onPress={() => setCaption(c.text)}
          />
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={caption}
        onChangeText={setCaption}
        multiline
        placeholder="Write your caption"
      />

      <Option
        label="Shape"
        value={aspect}
        onChange={setAspect}
        options={[
          ['square', 'Square 1:1'],
          ['portrait', 'Portrait 4:5'],
        ]}
      />
      <Text style={styles.label}>Text position</Text>
      <View style={styles.row}>
        {(['top', 'middle', 'bottom'] as const).map(id => (
          <Chip
            key={id}
            label={id[0].toUpperCase() + id.slice(1)}
            active={
              placement.cx === POSITION_PRESETS[id].cx &&
              placement.cy === POSITION_PRESETS[id].cy
            }
            onPress={() => setPlacement(POSITION_PRESETS[id])}
          />
        ))}
        {rotation !== 0 && (
          <Chip label="↺ Straighten" active={false} onPress={() => setRotation(0)} />
        )}
      </View>
      <Text style={styles.label}>Text size</Text>
      <View style={styles.row}>
        {(['S', 'M', 'L'] as const).map(id => (
          <Chip
            key={id}
            label={{ S: 'Small', M: 'Medium', L: 'Large' }[id]}
            active={sizeRatio === SIZE_PRESETS[id]}
            onPress={() => setSizeRatio(SIZE_PRESETS[id])}
          />
        ))}
      </View>
      <Option
        label="Style"
        value={theme}
        onChange={setTheme}
        options={(Object.keys(THEMES) as ThemeId[]).map(id => [
          id,
          THEMES[id].label,
        ])}
      />

      <View style={styles.actions}>
        <Pressable
          style={[styles.secondaryBtn, styles.flex]}
          onPress={onSave}
          disabled={busy || !layout}>
          <Text style={styles.secondaryBtnText}>Save to gallery</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryBtn, styles.flex]}
          onPress={onInstagram}
          disabled={busy || !layout}>
          <Text style={styles.primaryBtnText}>Post to Instagram</Text>
        </Pressable>
      </View>
      {status.kind !== 'idle' && (
        <View style={styles.status}>
          {busy && <ActivityIndicator />}
          <Text style={styles.statusText}>{status.message}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Option<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {options.map(([v, text]) => (
          <Chip
            key={v}
            label={text}
            active={v === value}
            onPress={() => onChange(v)}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAF7' },
  content: { paddingHorizontal: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#111', marginBottom: 12 },
  preview: {
    backgroundColor: '#E6E6E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { marginTop: 8, color: '#555', fontSize: 13 },
  hint: { marginTop: 4, color: '#555', fontSize: 13 },
  warn: {
    marginTop: 6,
    padding: 10,
    borderRadius: 6,
    backgroundColor: '#FFF4E0',
    color: '#8A4B00',
    fontSize: 13,
  },
  label: { marginTop: 16, marginBottom: 6, fontWeight: '600', color: '#222' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CCC',
    backgroundColor: '#FFF',
  },
  chipActive: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { color: '#222' },
  chipTextActive: { color: '#FFF' },
  input: {
    marginTop: 8,
    minHeight: 72,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CCC',
    backgroundColor: '#FFF',
    color: '#111',
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  flex: { flex: 1 },
  primaryBtn: {
    backgroundColor: '#D62976',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#FFF', fontWeight: '700' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#111',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#111', fontWeight: '600' },
  status: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 12 },
  statusText: { flex: 1, color: '#333' },
});
