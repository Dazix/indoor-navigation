import type { SyncConflict } from '../../hooks/useCloudSync';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface ConflictModalProps {
  conflict: SyncConflict | null;
  onResolve: (choice: 'mine' | 'cloud') => void;
  onClose: () => void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Shown when the cloud map changed since this device last synced and the device has unsynced edits too. */
export function ConflictModal({ conflict, onResolve, onClose }: ConflictModalProps) {
  return (
    <Modal
      open={conflict !== null}
      onClose={onClose}
      title="Map changed in the cloud"
      subtitle="Choose which version to keep"
      footer={
        // Three labels do not fit side by side in the dialog, so they are stacked at full width.
        <div className="flex w-full flex-col gap-2">
          <Button
            variant="secondary"
            fullWidth
            onClick={() => {
              onResolve('cloud');
            }}
          >
            Use cloud version
          </Button>
          <Button
            variant="danger"
            fullWidth
            onClick={() => {
              onResolve('mine');
            }}
          >
            Keep mine and publish
          </Button>
          <Button variant="ghost" fullWidth onClick={onClose}>
            Decide later
          </Button>
        </div>
      }
    >
      <div className="space-y-3 p-4 text-sm text-slate-700 dark:text-slate-300">
        <p>
          Someone published a newer version of this map
          {conflict?.remoteUpdatedAt ? ` (${dateFormat.format(conflict.remoteUpdatedAt)})` : ''} and this
          device also has changes that are not published yet.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">
          <li>
            <strong>Use cloud version</strong> replaces the copy on this device. Your unpublished changes are
            lost.
          </li>
          <li>
            <strong>Keep mine and publish</strong> replaces the cloud version with this device’s copy. Their
            changes are lost.
          </li>
        </ul>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Nothing changes until you choose. You can also export the map first from the map manager.
        </p>
      </div>
    </Modal>
  );
}
