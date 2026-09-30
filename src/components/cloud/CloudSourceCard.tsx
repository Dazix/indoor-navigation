import { Check, Link, ListChecks, LogIn, LogOut, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { CloudSync } from '../../hooks/useCloudSync';
import type { MapMeta } from '../../services/cloud/mapDocs';
import { buildConfigLink, type CloudSource } from '../../services/cloudConfig';
import { Button } from '../ui/Button';

interface CloudSourceCardProps {
  source: CloudSource;
  cloud: CloudSync;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** One Firebase project: its account, the choice of which of its maps this device uses, and a share link. */
export function CloudSourceCard({ source, cloud }: CloudSourceCardProps) {
  const user = cloud.users[source.id] ?? null;
  const [listing, setListing] = useState<MapMeta[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(source.enabledMapIds));
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadMaps = async () => {
    setLoading(true);
    const maps = await cloud.listMaps(source.id);
    setLoading(false);
    if (maps) setListing(maps);
  };

  const toggle = (mapId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(mapId)) next.add(mapId);
      return next;
    });
  };

  // Maps that are in use but missing from the catalog (published before it existed) stay visible and can be unticked.
  const listedIds = new Set(listing?.map((m) => m.mapId));
  const unlisted = listing ? source.enabledMapIds.filter((id) => !listedIds.has(id)) : [];
  const unchanged =
    selected.size === source.enabledMapIds.length && source.enabledMapIds.every((id) => selected.has(id));

  const openMapId = cloud.entry && cloud.publishSourceId === source.id ? cloud.entry.cloudMapId : undefined;
  const shareLink = buildConfigLink(new URL(import.meta.env.BASE_URL, window.location.origin).href, {
    firebase: source.firebase,
    ...(openMapId ? { mapId: openMapId } : {}),
  });

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{source.label}</div>
          <div className="truncate font-mono text-[11px] text-slate-500">{source.firebase.projectId}</div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 className="size-4" />}
          aria-label={`Remove ${source.label}`}
          onClick={() => {
            if (
              window.confirm(
                `Remove “${source.label}” from this device? Its maps stay as local maps and stop syncing.`,
              )
            ) {
              cloud.removeSource(source.id);
            }
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">
          {user ? (user.email ?? user.displayName ?? 'Signed in') : 'Not signed in'}
        </span>
        {user ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<LogOut className="size-4" />}
            onClick={() => void cloud.signOut(source.id)}
          >
            Sign out
          </Button>
        ) : (
          <Button size="sm" icon={<LogIn className="size-4" />} onClick={() => void cloud.signIn(source.id)}>
            Sign in with Google
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] text-slate-500">
          {source.enabledMapIds.length === 0
            ? 'No maps from this project are used on this device.'
            : `${source.enabledMapIds.length} map${source.enabledMapIds.length === 1 ? '' : 's'} used on this device.`}
        </p>
        <Button
          size="sm"
          variant="secondary"
          icon={<ListChecks className="size-4" />}
          disabled={loading}
          onClick={() => void loadMaps()}
        >
          {loading ? 'Loading…' : listing ? 'Reload maps' : 'Choose maps'}
        </Button>

        {listing && (
          <div className="space-y-2">
            {listing.length === 0 && unlisted.length === 0 && (
              <p className="text-xs text-slate-500">
                This project has no published maps yet. Publish one first; maps published with an older
                version appear here after their next publish.
              </p>
            )}
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {listing.map((m) => (
                <li key={m.mapId}>
                  <label className="flex cursor-pointer items-start gap-2 p-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.has(m.mapId)}
                      onChange={() => {
                        toggle(m.mapId);
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{m.name}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {m.nodeCount} locations · revision {m.revision} · {dateFormat.format(m.updatedAt)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
              {unlisted.map((mapId) => (
                <li key={mapId}>
                  <label className="flex cursor-pointer items-center gap-2 p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(mapId)}
                      onChange={() => {
                        toggle(mapId);
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{mapId}</span>
                  </label>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              disabled={unchanged}
              onClick={() => {
                cloud.selectMaps(source.id, [...selected]);
              }}
            >
              Use selected maps
            </Button>
            <p className="text-[11px] text-slate-500">
              Ticked maps are downloaded and kept in sync. Unticked maps are never downloaded; maps already on
              this device stay as local copies.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <Button
          size="sm"
          variant="ghost"
          icon={copied ? <Check className="size-4" /> : <Link className="size-4" />}
          onClick={() => {
            void navigator.clipboard.writeText(shareLink).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? 'Link copied' : 'Copy configuration link'}
        </Button>
        <p className="text-[11px] text-slate-500">
          Sets up this project{openMapId ? ' and opens the current map' : ''} on another device. It holds the
          Firebase web config, which is not a password; who may write is decided by your Firestore security
          rules.
        </p>
      </div>
    </div>
  );
}
