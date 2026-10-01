import { makeMessageBackup } from '../../../testing/fixtures';
import { backupAction, backupStatusText } from './backup-labels';

describe('backup labels', () => {
  it('says where a copy stands', () => {
    expect(backupStatusText(makeMessageBackup({ status: 'PENDING', requested: false }))).toBe(
      'Waiting',
    );
    expect(backupStatusText(makeMessageBackup({ status: 'PENDING', requested: true }))).toBe(
      'Waiting, first in line',
    );
    expect(backupStatusText(makeMessageBackup({ status: 'ACTIVE', stage: 'SENDING' }))).toBe(
      'Sending the copy',
    );
    expect(backupStatusText(makeMessageBackup({ status: 'ACTIVE', stage: null }))).toBe('Starting');
    expect(backupStatusText(makeMessageBackup())).toBe('Backed up');
    expect(backupStatusText(makeMessageBackup({ status: 'FAILED' }))).toBe('Failed');
    expect(
      backupStatusText(makeMessageBackup({ status: 'SKIPPED', skipReason: 'TOO_LARGE' })),
    ).toBe('Not backed up: Larger than Telegram accepts from this account');
  });

  it('offers "now" before a copy exists, "again" after, and nothing while it runs', () => {
    expect(backupAction(null)).toBe('now');
    expect(backupAction(makeMessageBackup({ status: 'PENDING', requested: false }))).toBe('now');
    expect(backupAction(makeMessageBackup({ status: 'PENDING', requested: true }))).toBeNull();
    expect(backupAction(makeMessageBackup({ status: 'ACTIVE' }))).toBeNull();
    expect(backupAction(makeMessageBackup({ status: 'FAILED' }))).toBe('now');
    expect(backupAction(makeMessageBackup())).toBe('again');
    expect(backupAction(makeMessageBackup({ status: 'SKIPPED' }))).toBe('again');
  });
});
