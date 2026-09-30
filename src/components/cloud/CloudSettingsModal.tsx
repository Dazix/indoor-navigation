import { CloudDownload, CloudUpload, Plus } from 'lucide-react';
import { useState } from 'react';
import type { CloudSync } from '../../hooks/useCloudSync';
import { FirebaseConfigSchema, parseFirebaseSnippet, type FirebaseConfig } from '../../services/cloudConfig';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { CloudSourceCard } from './CloudSourceCard';

interface CloudSettingsModalProps {
  open: boolean;
  onClose: () => void;
  cloud: CloudSync;
}

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800';
const heading = 'text-[11px] font-bold tracking-wider text-slate-400 uppercase';
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type Draft = Record<keyof FirebaseConfig | 'label', string>;

const EMPTY_DRAFT: Draft = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
  storageBucket: '',
  messagingSenderId: '',
  label: '',
};

function draftFrom(firebase: FirebaseConfig, label: string): Draft {
  return {
    apiKey: firebase.apiKey,
    authDomain: firebase.authDomain,
    projectId: firebase.projectId,
    appId: firebase.appId,
    storageBucket: firebase.storageBucket ?? '',
    messagingSenderId: firebase.messagingSenderId ?? '',
    label,
  };
}

function firebaseFromDraft(draft: Draft): FirebaseConfig | null {
  const parsed = FirebaseConfigSchema.safeParse({
    apiKey: draft.apiKey,
    authDomain: draft.authDomain,
    projectId: draft.projectId,
    appId: draft.appId,
    storageBucket: draft.storageBucket.trim() || undefined,
    messagingSenderId: draft.messagingSenderId.trim() || undefined,
  });
  return parsed.success ? parsed.data : null;
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

function AddSourceForm({ cloud, first }: { cloud: CloudSync; first: boolean }) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [snippet, setSnippet] = useState('');
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  };

  const onSnippet = (text: string) => {
    setSnippet(text);
    const parsed = parseFirebaseSnippet(text);
    if (parsed) {
      setDraft((d) => draftFrom(parsed, d.label));
      setError(null);
    }
  };

  const add = () => {
    const firebase = firebaseFromDraft(draft);
    if (!firebase) {
      setError('Fill in API key, auth domain, project ID and app ID.');
      return;
    }
    cloud.saveSource(firebase, draft.label);
    setDraft(EMPTY_DRAFT);
    setSnippet('');
  };

  return (
    <section className="space-y-3 p-4">
      <h3 className={heading}>{first ? 'Firebase connection' : 'Add another Firebase project'}</h3>
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
        label="Name (optional)"
        value={draft.label}
        onChange={set('label')}
        placeholder="e.g. Praha, defaults to the project ID"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-[11px] text-slate-500">
        Adding a project that is already listed updates its credentials. Afterwards choose which of its maps
        this device uses.
      </p>
      <Button size="sm" icon={<Plus className="size-4" />} onClick={add}>
        Add project
      </Button>
    </section>
  );
}

function CloudSettingsForm({ cloud }: { cloud: CloudSync }) {
  const { entry, busy, sources } = cloud;
  const linkedSource = sources.find((s) => s.id === cloud.publishSourceId);

  return (
    <div className="divide-y divide-slate-200 dark:divide-slate-800">
      {cloud.configured && (
        <section className="space-y-3 p-4">
          <h3 className={heading}>This map</h3>
          {cloud.needsPublishChoice && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Publish to</span>
              <select
                className={input}
                value={cloud.publishSourceId ?? ''}
                onChange={(e) => {
                  cloud.setPublishSource(e.target.value);
                }}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <dl className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
            {sources.length > 1 && (
              <div className="flex justify-between gap-3">
                <dt>Project</dt>
                <dd className="truncate">{linkedSource?.label ?? 'unknown'}</dd>
              </div>
            )}
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
          <p className="text-xs text-slate-500">
            Everyone can open and navigate cloud maps. Signing in is only needed to publish changes.
          </p>
        </section>
      )}

      {sources.length > 0 && (
        <section className="space-y-3 p-4">
          <h3 className={heading}>Firebase projects</h3>
          {sources.map((source) => (
            <CloudSourceCard key={source.id} source={source} cloud={cloud} />
          ))}
        </section>
      )}

      <AddSourceForm cloud={cloud} first={sources.length === 0} />
    </div>
  );
}

/** Add Firebase projects, choose which of their maps this device uses, sign in, publish and share the setup. */
export function CloudSettingsModal({ open, onClose, cloud }: CloudSettingsModalProps) {
  const count = cloud.sources.length;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Cloud sync"
      subtitle={
        count === 0
          ? 'Optional: publish maps to your own Firebase'
          : `${count} Firebase project${count === 1 ? '' : 's'} connected`
      }
    >
      <CloudSettingsForm cloud={cloud} />
    </Modal>
  );
}
