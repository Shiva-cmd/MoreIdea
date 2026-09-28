# MoreIdea: image + caption → Instagram

A single React Native screen (RN 0.87, tested on Android 17). The shop owner picks a photo from the gallery or camera and places the caption on it. The app renders the finished post **on the device at full resolution** and hands it to Instagram.

`npm install && npx react-native run-android`. Code: `src/layout.ts` (text-fitting rules), `src/Post.tsx` (the drawing), `src/PostComposer.tsx` (the screen), `src/exportPost.ts` (file, gallery, Instagram).

## Posting to Instagram from a mobile app: what I found

- **Auto-publishing is not possible from the device alone.** Instagram's only publishing API is the Graph API Content Publishing endpoint. It works **only for Business/Creator accounts linked to a Facebook Page**, needs a Meta app with `instagram_content_publish` approved in App Review, and takes the image as a **public HTTPS URL** that Meta fetches. So "post for me" requires: the owner converting to a professional account, an OAuth login, our own server/CDN to host the JPEG, and Meta's review. Personal accounts can't be published to at all. None of that fits "no login, one screen, composed on device".
- **What is possible:** handing the file to the Instagram app. On Android that is an `ACTION_SEND` intent targeted at `com.instagram.android`, which opens Instagram's own Feed / Story / Message picker with our image. On iOS the closest equivalents are the system share sheet, or `instagram-stories://share` for Stories (which now requires a Facebook App ID).
- **Instagram ignores any caption passed in a share intent** (it has for years). So the caption can't be pre-filled.
- **What I built:** "Post to Instagram" copies the caption to the clipboard, then opens Instagram directly with the image (checked via `<queries>` package visibility). The owner taps Next and long-presses to paste the caption. If Instagram isn't installed, it falls back to the system share sheet. "Save to gallery" is also there, since that's where owners often go first.

## How the flattened, full-resolution image is made

The post is drawn with **@shopify/react-native-skia**. One component (`Post.tsx`) draws the photo, the text band and the text in **output-pixel coordinates**. The on-screen preview renders that component scaled down inside a `<Canvas>`. Export renders the *same* component offscreen with `drawAsImage()` at the full output size and encodes it as JPEG (quality 95). So the preview and the file can't drift apart, and the export is never a screenshot of the phone-sized view (which is what `react-native-view-shot` would give you).

- **Size:** the photo is centre-cropped to 1:1 or 4:5 (the shapes Instagram shows in the feed) at the source's native resolution. It is never upscaled, and capped at 4096 px on the longest side (the GPU texture limit). A 2000×1500 photo exports as 1500×1500. The app warns when the source is below 1080 px.
- **Hindi and emoji:** Noto Sans, Noto Sans Devanagari and Noto Color Emoji are bundled and given to Skia's Paragraph API as a font fallback chain. HarfBuzz shaping in Skia handles conjuncts and matras (ों, ज़्), so rendering doesn't depend on which fonts the phone has.
- **What the owner controls and can't break:** shape, text position (top/middle/bottom), size (S/M/L) and three colour styles. The text always sits on a contrasting band inside safe margins, so it can't be dragged off the image, made unreadable, or put in a clashing colour.
- **Long captions:** the text first shrinks step by step down to a minimum readable size. The text is also capped at ~40% of the photo's height. If it still doesn't fit, it's cut at the last whole line with "…" and a warning explains that the full text still goes in the Instagram caption (via the clipboard).

**What I gave up:** Skia adds several MB of native code per ABI, plus ~3.9 MB of bundled fonts. The layout is preset-based rather than free-form (no dragging, no per-word styling). JPEG instead of PNG (much smaller, and Instagram re-encodes anyway). And rendering goes through the GPU, which is where the 4096 px cap comes from.

## With two weeks instead of an afternoon

- Talk to 5 shop owners first. Watch whether they want *more* control (drag, pinch) or *less* (one "make it look good" button).
- Real Instagram publishing for owners who have (or can be walked into) a Business account: Meta login, a small upload service with signed URLs, a scheduled-post queue, and App Review.
- iOS polish: Stories via `instagram-stories://` with the image and brand colours, and saving to Photos with the proper permission flow.
- Smarter layout: detect faces and busy areas to auto-place text; brand colour picked from the shop's logo; auto-split long captions into a carousel.
- Font and size budget: subset Noto to the Devanagari + Latin + emoji ranges actually used; per-ABI APK splits.
- Tests around the layout rules (fit/shrink/truncate across scripts), plus visual regression tests on the exported JPEG.
