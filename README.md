# MoreIdea: image + caption → Instagram

One React Native screen (RN 0.87, tested on an Android 17 emulator and an iOS 26 simulator). The owner picks a photo (gallery or camera) and places the caption on it. The app renders the post **on the device at full resolution** and hands it to Instagram.

Run: `npm install`, then `npx react-native run-android`, or `cd ios && pod install && cd .. && npx react-native run-ios`.
Code: `src/layout.ts` (text rules), `src/Post.tsx` (drawing), `src/PostComposer.tsx` (screen), `src/exportPost.ts` (save/share).

## Posting to Instagram: what I found

- **Auto-posting from the device isn't possible.** The only publishing API (Graph API) needs a Business/Creator account linked to a Facebook Page, a Meta app approved in App Review, an OAuth login, and the image at a **public URL** (so a server). Personal accounts can't be published to at all.
- **What works:** handing the file to the Instagram app. On Android that's a share intent aimed at `com.instagram.android`, which opens Instagram's Feed/Story/Message picker. On iOS it's the share sheet (Stories via `instagram-stories://` needs a Facebook App ID).
- **Instagram ignores captions passed in a share**, so they can't be pre-filled.
- **What I built:** "Post to Instagram" copies the caption, then opens Instagram with the image; the owner pastes and posts. If Instagram isn't installed, the system share sheet opens. "Save to gallery" is there too.

## How the full-resolution image is made

**@shopify/react-native-skia** draws the post in output pixels in one component. The preview shows it scaled down, and the export renders the *same* component offscreen with `drawAsImage()` and saves a JPEG (quality 95). So preview and file always match, and the export is never a screenshot of the phone-sized view (which `react-native-view-shot` would give).

- **Size:** centre-cropped to 1:1 or 4:5 at the photo's native resolution, never upscaled, capped at 4096 px. The app warns below 1080 px.
- **Hindi and emoji:** bundled Noto Sans + Noto Sans Devanagari, shaped by Skia, so matras and conjuncts (ों, ज़्) render on any phone. iOS can't draw the bundled COLRv1 emoji font, so emoji use Apple Color Emoji there.
- **Owner controls:** drag, pinch and twist the text (react-native-gesture-handler v3), or tap presets for position and size; also shape and three colour styles. Guard rails: the text stays inside safe margins (even when rotated), size stays between readable limits, rotation snaps level within 5°, and the text always sits on a contrasting band.
- **Long captions:** shrink to a minimum readable size; if still too tall (max ~40% of the photo), cut at a whole line with "…" plus a warning. The full text still goes in the Instagram caption.
- **Empty caption:** no text and no band, just the photo.

**What I gave up:** app size (Skia's native code + ~3.9 MB of fonts); gestures update React state on the JS thread, fine here but not UI-thread smooth; JPEG instead of PNG (much smaller, and Instagram re-encodes anyway).

## With two weeks instead of an afternoon

- Watch 5 shop owners use it: do gestures help, or would one "make it look good" button be better?
- Real publishing for Business accounts: Meta login, upload service, scheduled posts, App Review.
- Gestures on the UI thread with Reanimated; iOS Stories sharing; add-only Photos permission.
- Smarter layout: auto-place text away from faces and busy areas; brand colours from the logo.
- Smaller app: subset the fonts, per-ABI builds. Tests for the fit/shrink/cut rules and the exported image.
