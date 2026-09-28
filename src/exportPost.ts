import { Platform } from 'react-native';
import { CachesDirectoryPath, writeFile } from '@dr.pogodin/react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import Clipboard from '@react-native-clipboard/clipboard';
import Share, { Social } from 'react-native-share';
import { ImageFormat, type SkImage } from '@shopify/react-native-skia';

const INSTAGRAM_ANDROID = 'com.instagram.android';

/** Encode the rendered post as a high-quality JPEG in the app cache. */
export async function writeJpeg(image: SkImage): Promise<string> {
  const path = `${CachesDirectoryPath}/post-${Date.now()}.jpg`;
  await writeFile(path, image.encodeToBase64(ImageFormat.JPEG, 95), 'base64');
  return path;
}

export async function saveToGallery(path: string) {
  await CameraRoll.saveAsset(`file://${path}`, { type: 'photo' });
}

export type InstagramResult = 'instagram' | 'share-sheet';

/**
 * Instagram gives third-party apps no way to post on the user's behalf from
 * the device, and it ignores any caption passed in a share intent. So: copy the
 * caption, hand the image to the Instagram app, and let the owner paste + post.
 * If Instagram isn't installed we fall back to the system share sheet.
 */
export async function shareToInstagram(
  path: string,
  caption: string,
): Promise<InstagramResult> {
  Clipboard.setString(caption);
  const url = `file://${path}`;

  if (Platform.OS === 'android') {
    const { isInstalled } = await Share.isPackageInstalled(INSTAGRAM_ANDROID);
    if (isInstalled) {
      await Share.shareSingle({
        social: Social.Instagram,
        url,
        type: 'image/jpeg',
      });
      return 'instagram';
    }
  }

  await Share.open({ url, type: 'image/jpeg', failOnCancel: false });
  return 'share-sheet';
}
