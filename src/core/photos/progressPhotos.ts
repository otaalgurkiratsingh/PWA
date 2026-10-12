/**
 * Optional private progress/inspiration photos.
 *
 * - Upload only after the separate "photo storage" permission, cropped and re-encoded on the phone
 *   (re-encoding drops EXIF/GPS). Path: "<owner id>/<random id>.jpg" — no names, slots or dates.
 * - Reads use the person's own session and become in-memory object URLs that the caller revokes;
 *   nothing is written to this device's storage or the offline cache, so another account on the
 *   same phone never sees a previous person's thumbnails.
 * - Separate from food pictures: food art is bundled; meal photos live inside meal records.
 */
import { supabase } from '@/core/auth/supabase';
import { newId } from '@/core/ids';

export type PhotoSlot = 'front' | 'back' | 'left' | 'right' | 'inspiration';
export const SLOTS: { slot: PhotoSlot; label: string }[] = [
  { slot: 'front', label: 'Front' }, { slot: 'back', label: 'Back' }, { slot: 'left', label: 'Left side' }, { slot: 'right', label: 'Right side' },
  { slot: 'inspiration', label: 'Inspiration' },
];
const BUCKET = 'progress-photos';
const MAX_BYTES = 1_572_864;

export interface StoredPhoto { id: string; slot: PhotoSlot; object_path: string; created_at: string }

export function jpegBytesFromDataUrl(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (out[0] !== 0xff || out[1] !== 0xd8 || out[2] !== 0xff) throw new Error('Only JPEG photos can be saved.');
  if (out.length > MAX_BYTES) throw new Error('That photo is too large.');
  return out;
}

export async function listPhotos(): Promise<StoredPhoto[]> {
  const { data, error } = await (await supabase()).from('progress_photos').select('id, slot, object_path, created_at').order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error('Couldn’t load your photos.');
  return (data ?? []) as StoredPhoto[];
}

export async function uploadPhoto(ownerId: string, slot: PhotoSlot, dataUrl: string, size: number): Promise<StoredPhoto> {
  const bytes = jpegBytesFromDataUrl(dataUrl);
  const id = newId();
  const path = `${ownerId}/${id}.jpg`;
  const db = await supabase();
  const up = await db.storage.from(BUCKET).upload(path, new Blob([bytes as BlobPart], { type: 'image/jpeg' }), { contentType: 'image/jpeg', upsert: false, cacheControl: 'no-store' });
  if (up.error) throw new Error('Couldn’t save the photo. Check that photo storage is turned on and you’re online.');
  const row = await db.from('progress_photos').insert({ id, slot, object_path: path, width: size, height: size, bytes: bytes.length }).select('id, slot, object_path, created_at').single();
  if (row.error) {
    await db.storage.from(BUCKET).remove([path]);
    throw new Error('Couldn’t save the photo.');
  }
  return row.data as StoredPhoto;
}

export async function deletePhoto(p: Pick<StoredPhoto, 'id' | 'object_path'>): Promise<void> {
  const db = await supabase();
  const rm = await db.storage.from(BUCKET).remove([p.object_path]);
  const del = await db.from('progress_photos').delete().eq('id', p.id);
  if (rm.error || del.error) throw new Error('Couldn’t delete that photo. Try again.');
}

/** Delete every stored photo (used before account deletion and from Settings). */
export async function deleteAllPhotos(): Promise<number> {
  const all = await listPhotos();
  for (const p of all) await deletePhoto(p);
  return all.length;
}

/** Authorized, short-lived read: the caller must URL.revokeObjectURL when done. */
export async function photoObjectUrl(path: string): Promise<string> {
  const { data, error } = await (await supabase()).storage.from(BUCKET).download(path);
  if (error || !data) throw new Error('Couldn’t load the photo.');
  return URL.createObjectURL(data);
}
