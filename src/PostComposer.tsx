import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Canvas,
  Group,
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
  THEMES,
  layoutText,
  outputSize,
  type Aspect,
  type Position,
  type TextSize,
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
  const [position, setPosition] = useState<Position>('bottom');
  const [size, setSize] = useState<TextSize>('M');
  const [theme, setTheme] = useState<ThemeId>('dark');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const image = useImage(source);
  const fonts = useFonts({
    NotoSans: [require('../assets/fonts/NotoSans-Bold.ttf')],
    NotoSansDevanagari: [require('../assets/fonts/NotoSansDevanagari-Bold.ttf')],
    NotoColorEmoji: [require('../assets/fonts/NotoColorEmoji.ttf')],
  });

  const out = useMemo(
    () => (image ? outputSize(image.width(), image.height(), aspect) : null),
    [image, aspect],
  );

  const layout = useMemo(() => {
    if (!out || !fonts) {
      return null;
    }
    const text = caption.trim() || ' ';
    return layoutText(text, out.width, out.height, position, size, theme, fonts);
  }, [out, fonts, caption, position, size, theme]);

  const previewW = screenW - 32;
  const previewH = out ? (previewW * out.height) / out.width : previewW;
  const scale = out ? previewW / out.width : 1;
  const lowRes =
    image && Math.min(image.width(), image.height()) < MIN_SOURCE_SIDE;

  const pickImage = async (from: 'gallery' | 'camera') => {
    // quality: 1 and no maxWidth/maxHeight keep the photo at full resolution.
    const options = { mediaType: 'photo', quality: 1 } as const;
    const res: ImagePickerResponse =
      from === 'camera'
        ? await launchCamera({ ...options, saveToPhotos: false })
        : await launchImageLibrary(options);
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
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Create post</Text>

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
              />
            </Group>
          </Canvas>
        ) : (
          <ActivityIndicator />
        )}
      </View>

      {out && (
        <Text style={styles.meta}>
          Output: {out.width}×{out.height}px
          {lowRes ? '  ⚠️ Photo is small, may look blurry on Instagram' : ''}
        </Text>
      )}
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
      <Option
        label="Text position"
        value={position}
        onChange={setPosition}
        options={[
          ['top', 'Top'],
          ['middle', 'Middle'],
          ['bottom', 'Bottom'],
        ]}
      />
      <Option
        label="Text size"
        value={size}
        onChange={setSize}
        options={[
          ['S', 'Small'],
          ['M', 'Medium'],
          ['L', 'Large'],
        ]}
      />
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
