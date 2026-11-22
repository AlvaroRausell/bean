import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { HydratedState } from '@/db/repositories';
import {
  BackupPreview,
  buildBackupPayload,
  parseAndValidateBackup,
} from './backupService';

export async function exportBackupToShareSheet(state: HydratedState): Promise<void> {
  const payload = buildBackupPayload(state);
  const dateTag = new Date().toISOString().slice(0, 10);
  const filename = `bean-backup-${dateTag}.json`;
  const file = new File(Paths.cache, filename);

  file.write(JSON.stringify(payload, null, 2));

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Sharing is not available on this device.');
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Export Bean Travel Backup',
    UTI: 'public.json',
  });
}

export async function pickAndValidateBackupFile(): Promise<BackupPreview | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (res.canceled || !res.assets || res.assets.length === 0) {
    return null;
  }

  const asset = res.assets[0];
  const file = new File(asset.uri);
  const raw = await file.text();
  return parseAndValidateBackup(raw);
}
