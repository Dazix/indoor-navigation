import { Check, CloudDownload, CloudUpload, Link, LogIn, LogOut } from 'lucide-react';
import { useState } from 'react';
import type { CloudSync } from '../../hooks/useCloudSync';
import {
  buildConfigLink,
  FirebaseConfigSchema,
  isValidCloudMapId,
  parseFirebaseSnippet,
  type FirebaseConfig,
  type StoredCloudConfig,
} from '../../services/cloudConfig';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface CloudSettingsModalProps {
  open: boolean;
  onClose: () => void;
  cloud: CloudSync;
}

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800';
const heading = 'text-[11px] font-bold tracking-wider text-slate-400 uppercase';
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type Draft = Record<keyof FirebaseConfig | 'mapId', string>;

function draftFrom(firebase: FirebaseConfig | undefined, mapId: string | undefined): Draft {
  return {
    apiKey: firebase?.apiKey ?? '',
    authDomain: firebase?.authDomain ?? '',
    projectId: firebase?.projectId ?? '',
    appId: firebase?.appId ?? '',
    storageBucket: firebase?.storageBucket ?? '',
    messagingSenderId: firebase?.messagingSenderId ?? '',
    mapId: mapId ?? '',
  };
}

/** Result of turning the form into stored config: either the config to save or what is wrong. */
function configFromDraft(
  draft: Draft,
): { ok: true; config: StoredCloudConfig } | { ok: false; error: string } {
  const mapId = draft.mapId.trim();
  if (mapId && !isValidCloudMapId(mapId)) {
    return {
      ok: false,
      error: 'The map id may only contain letters, digits, - and _ (up to 100 characters).',
    };
  }
  const hasAnyFirebaseField = [draft.apiKey, draft.authDomain, draft.projectId, draft.appId].some((v) =>
    v.trim(),
  );
  if (!hasAnyFirebaseField) return { ok: true, config: mapId ? { mapId } : {} };
  const parsed = FirebaseConfigSchema.safeParse({
    apiKey: draft.apiKey,
    authDomain: draft.authDomain,
    projectId: draft.projectId,
    appId: draft.appId,
    storageBucket: draft.storageBucket.trim() || undefined,
    messagingSenderId: draft.messagingSenderId.trim() || undefined,
  });
  if (!parsed.success) return { ok: false, error: 'Fill in API key, auth domain, project ID and app ID.' };
  return { ok: true, config: { firebase: parsed.data, ...(mapId ? { mapId } : {}) } };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <input
        className={input}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </label>
  );
}

function CloudSettingsForm({ cloud, onClose }: { cloud: CloudSync; onClose: () => void }) {
  const { config, storedConfig, entry, user, busy } = cloud;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(storedConfig.firebase, storedConfig.mapId));
  const [snippet, setSnippet] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  };

  const onSnippet = (text: string) => {
    setSnippet(text);
    const parsed = parseFirebaseSnippet(text);
    if (parsed) {
      setDraft((d) => ({ ...draftFrom(parsed, d.mapId) }));
      setError(null);
    }
  };

  const save = () => {
    const result = configFromDraft(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    cloud.saveConfig(result.config);
    onClose();
  };

  const shareMapId = entry?.cloudMapId ?? config?.mapId;
  const shareLink = config
    ? buildConfigLink(new URL(import.meta.env.BASE_URL, window.location.origin).href, {
        firebase: config.firebase,
        ...(shareMapId ? { mapId: shareMapId } : {}),
      })
    : null;

  return (
    <div className="divide-y divide-slate-200 dark:divide-slate-800">
      {cloud.configured && (
        <section className="space-y-3 p-4">
          <h3 className={heading}>Account</h3>
          <p className="text-xs text-slate-500">
            Everyone can open and navigate cloud maps. Signing in is only needed to publish changes.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">
              {user ? (user.email ?? user.displayName ?? 'Signed in') : 'Not signed in'}
            </span>
            {user ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<LogOut className="size-4" />}
                onClick={() => void cloud.signOut()}
              >
                Sign out
              </Button>
            ) : (
              <Button size="sm" icon={<LogIn className="size-4" />} onClick={() => void cloud.signIn()}>
                Sign in with Google
              </Button>
            )}
          </div>
        </section>
      )}

      {cloud.configured && (
        <section className="space-y-3 p-4">
          <h3 className={heading}>This map</h3>
          <dl className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex justify-between gap-3">
              <dt>Cloud map id</dt>
              <dd className="truncate font-mono">{entry?.cloudMapId ?? 'not published yet'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Last synced</dt>
              <dd>{entry?.lastSyncedAt ? dateFormat.format(entry.lastSyncedAt) : 'never'}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={<CloudUpload className="size-4" />}
              disabled={busy !== null}
              onClick={() => void cloud.publish()}
            >
              {entry ? 'Publish changes' : 'Publish to cloud'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<CloudDownload className="size-4" />}
              disabled={busy !== null || !entry}
              onClick={() => void cloud.pullLatest()}
            >
              Pull latest
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-3 p-4">
        <h3 className={heading}>Firebase connection</h3>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Paste the config from the Firebase console
          </span>
          <textarea
            className={`${input} h-20 font-mono text-xs`}
            value={snippet}
            placeholder={'const firebaseConfig = {\n  apiKey: "…",\n  …'}
            spellCheck={false}
            onChange={(e) => {
              onSnippet(e.target.value);
            }}
          />
        </label>
        <Field label="API key" value={draft.apiKey} onChange={set('apiKey')} />
        <Field
          label="Auth domain"
          value={draft.authDomain}
          onChange={set('authDomain')}
          placeholder="project.firebaseapp.com"
        />
        <Field label="Project ID" value={draft.projectId} onChange={set('projectId')} />
        <Field label="App ID" value={draft.appId} onChange={set('appId')} />
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500">Optional fields</summary>
          <div className="mt-2 space-y-3">
            <Field label="Storage bucket" value={draft.storageBucket} onChange={set('storageBucket')} />
            <Field
              label="Messaging sender ID"
              value={draft.messagingSenderId}
              onChange={set('messagingSenderId')}
            />
          </div>
        </details>
        <Field
          label="Map id to open (optional)"
          value={draft.mapId}
          onChange={set('mapId')}
          placeholder="e.g. headquarters-floor-2"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={save}>
            Save
          </Button>
          {(storedConfig.firebase ?? storedConfig.mapId) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (window.confirm('Remove the cloud settings from this device? Your maps stay.')) {
                  cloud.clearConfig();
                  onClose();
                }
              }}
            >
              Remove settings
            </Button>
          )}
        </div>
      </section>

      {shareLink && (
        <section className="space-y-2 p-4">
          <h3 className={heading}>Share configuration</h3>
          <p className="text-[11px] text-slate-500">
            This link sets up the same cloud connection{shareMapId ? ' and opens this map' : ''} on another
            device. It contains the Firebase web config. That is not a password, but anyone with the link can
            point this app at your project, so who may write is decided by your Firestore security rules.
          </p>
          <Button
            size="sm"
            variant="secondary"
            icon={copied ? <Check className="size-4" /> : <Link className="size-4" />}
            onClick={() => {
              void navigator.clipboard.writeText(shareLink).then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? 'Link copied' : 'Copy configuration link'}
          </Button>
        </section>
      )}
    </div>
  );
}

/** Enter or edit the Firebase credentials, sign in, publish and share the setup. */
export function CloudSettingsModal({ open, onClose, cloud }: CloudSettingsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Cloud sync"
      subtitle={cloud.configured ? 'Connected to Firebase' : 'Optional: publish maps to your own Firebase'}
    >
      <CloudSettingsForm cloud={cloud} onClose={onClose} />
    </Modal>
  );
}
