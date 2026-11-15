import { ApiError, apiBlob } from './api';
import { deleteMedia, fetchMedia, uploadPhoto, type ApiMedia } from './healthApi';

export interface Selfie {
  id: string;
  createdAt: number;
  blob: Blob;
  note: string;
}

// True when the Worker reports that photo storage (R2) is not set up.
export function isStorageUnavailable(error: unknown) {
  return error instanceof ApiError && error.status === 503;
}

// Downloads one stored photo through the Worker with the session cookie.
async function toSelfie(media: ApiMedia, signal?: AbortSignal): Promise<Selfie> {
  return { id: media.id, createdAt: Date.parse(media.ts), blob: await apiBlob(media.url, signal), note: media.note ?? '' };
}

// Lists the user's saved selfies from R2, newest first.
export async function listSelfies(userId: string, signal?: AbortSignal) {
  const photos = (await fetchMedia(userId, { signal })).filter(m => m.kind === 'photo');
  const selfies = await Promise.all(photos.map(m => toSelfie(m, signal)));
  return selfies.sort((a, b) => b.createdAt - a.createdAt);
}

// Uploads a captured selfie to the user's private R2 folder.
export async function saveSelfie(blob: Blob, note = ''): Promise<Selfie> {
  const media = await uploadPhoto(blob, note);
  return { id: media.id, createdAt: Date.parse(media.ts), blob, note: media.note ?? '' };
}

// Permanently deletes a selfie from R2 and D1.
export async function deleteSelfie(id: string) {
  await deleteMedia(id);
}
