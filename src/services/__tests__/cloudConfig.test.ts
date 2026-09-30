import { describe, expect, it } from 'vitest';
import {
  applyUrlConfig,
  buildConfigLink,
  decodeFirebaseConfig,
  EMPTY_CLOUD_CONFIG,
  enableMap,
  encodeFirebaseConfig,
  findSource,
  hasUrlConfig,
  parseFirebaseSnippet,
  parseStoredCloudConfig,
  parseUrlConfig,
  removeSource,
  setEnabledMaps,
  sourceIdFor,
  stripConfigParams,
  upsertSource,
  type FirebaseConfig,
} from '../cloudConfig';

const firebase: FirebaseConfig = {
  apiKey: 'AIza-test_key',
  authDomain: 'demo.firebaseapp.com',
  projectId: 'demo',
  appId: '1:123:web:abc',
};

describe('firebase config encoding', () => {
  it('round-trips through base64url', () => {
    const encoded = encodeFirebaseConfig({ ...firebase, storageBucket: 'demo.appspot.com' });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeFirebaseConfig(encoded)).toEqual({ ...firebase, storageBucket: 'demo.appspot.com' });
  });

  it('round-trips non-ASCII values', () => {
    const config = { ...firebase, projectId: 'příliš-žluťoučký' };
    expect(decodeFirebaseConfig(encodeFirebaseConfig(config))).toEqual(config);
  });

  it('rejects garbage and incomplete configs', () => {
    expect(decodeFirebaseConfig('not base64 !!')).toBeNull();
    expect(decodeFirebaseConfig(encodeFirebaseConfig({ ...firebase, apiKey: '' }))).toBeNull();
    expect(decodeFirebaseConfig(btoa('{"apiKey":"x"}'))).toBeNull();
  });
});

describe('URL config', () => {
  it('parses cfg and cloudMap', () => {
    const search = `?cfg=${encodeFirebaseConfig(firebase)}&cloudMap=office_1`;
    expect(parseUrlConfig(search)).toEqual({ firebase, mapId: 'office_1' });
  });

  it('accepts a map id alone', () => {
    expect(parseUrlConfig('?cloudMap=office-1')).toEqual({ mapId: 'office-1' });
  });

  it('ignores invalid values and unrelated params', () => {
    expect(parseUrlConfig('?map=maps/a.json')).toBeNull();
    expect(parseUrlConfig('?cfg=broken')).toBeNull();
    expect(parseUrlConfig('?cloudMap=a/b')).toBeNull();
    expect(parseUrlConfig('?cloudMap=a~b')).toBeNull();
  });

  it('keeps a valid part when the other one is invalid', () => {
    expect(parseUrlConfig(`?cfg=${encodeFirebaseConfig(firebase)}&cloudMap=a/b`)).toEqual({ firebase });
  });

  it('detects config params even when invalid, so they still get stripped', () => {
    expect(hasUrlConfig('?cfg=broken')).toBe(true);
    expect(hasUrlConfig('?map=x')).toBe(false);
  });

  it('strips only config params', () => {
    const href = `https://app.example/indoor/?map=a.json&cfg=abc&cloudMap=m1&to=n1#editor`;
    expect(stripConfigParams(href)).toBe('https://app.example/indoor/?map=a.json&to=n1#editor');
  });

  it('builds a link that parses back and drops search and hash', () => {
    const link = buildConfigLink('https://app.example/indoor/?x=1#editor', { firebase, mapId: 'm1' });
    expect(link).not.toContain('#');
    expect(link).not.toContain('x=1');
    expect(parseUrlConfig(new URL(link).search)).toEqual({ firebase, mapId: 'm1' });
  });
});

describe('parseFirebaseSnippet', () => {
  const consoleSnippet = `
    // Import the functions you need from the SDKs you need
    import { initializeApp } from "firebase/app";
    const firebaseConfig = {
      apiKey: "AIza-test_key",
      authDomain: "demo.firebaseapp.com",
      projectId: "demo",
      storageBucket: "demo.firebasestorage.app",
      messagingSenderId: "123456",
      appId: "1:123:web:abc"
    };
    const app = initializeApp(firebaseConfig);
  `;

  it('reads the snippet shown by the Firebase console', () => {
    expect(parseFirebaseSnippet(consoleSnippet)).toEqual({
      ...firebase,
      storageBucket: 'demo.firebasestorage.app',
      messagingSenderId: '123456',
    });
  });

  it('reads JSON and single-quoted values', () => {
    expect(parseFirebaseSnippet(JSON.stringify(firebase))).toEqual(firebase);
    expect(
      parseFirebaseSnippet(
        "{ apiKey: 'AIza-test_key', authDomain: 'demo.firebaseapp.com', projectId: 'demo', appId: '1:123:web:abc' }",
      ),
    ).toEqual(firebase);
  });

  it('returns null when required values are missing or the text is unrelated', () => {
    expect(parseFirebaseSnippet('apiKey: "only-this"')).toBeNull();
    expect(parseFirebaseSnippet('hello world')).toBeNull();
    expect(parseFirebaseSnippet('')).toBeNull();
  });
});

const liberec: FirebaseConfig = { ...firebase, projectId: 'liberec', authDomain: 'liberec.firebaseapp.com' };

describe('parseStoredCloudConfig', () => {
  it('validates persisted sources', () => {
    const stored = upsertSource(EMPTY_CLOUD_CONFIG, firebase);
    expect(parseStoredCloudConfig(stored)).toEqual(stored);
    expect(parseStoredCloudConfig({ sources: [{ id: 'x' }] })).toBeNull();
    expect(parseStoredCloudConfig('nope')).toBeNull();
  });

  it('migrates the single-config shape of the first cloud version', () => {
    expect(parseStoredCloudConfig({ firebase, mapId: 'm1' })).toEqual({
      sources: [{ id: 'demo', label: 'demo', firebase, enabledMapIds: ['m1'] }],
    });
    expect(parseStoredCloudConfig({ firebase })?.sources[0]?.enabledMapIds).toEqual([]);
    expect(parseStoredCloudConfig({})).toEqual(EMPTY_CLOUD_CONFIG);
    expect(parseStoredCloudConfig({ mapId: 'a/b' })).toBeNull();
  });
});

describe('sources', () => {
  it('derives a stable, path-safe id from the project', () => {
    expect(sourceIdFor({ ...firebase, projectId: 'my.project/1' })).toBe('my_project_1');
  });

  it('adds sources and updates the one for the same project instead of duplicating it', () => {
    const two = upsertSource(upsertSource(EMPTY_CLOUD_CONFIG, firebase, 'Praha'), liberec);
    expect(two.sources.map((s) => [s.id, s.label])).toEqual([
      ['demo', 'Praha'],
      ['liberec', 'liberec'],
    ]);
    const updated = upsertSource(enableMap(two, 'demo', 'm1'), { ...firebase, apiKey: 'new' });
    expect(updated.sources).toHaveLength(2);
    expect(updated.sources[0]).toMatchObject({ label: 'Praha', enabledMapIds: ['m1'] });
    expect(updated.sources[0]?.firebase.apiKey).toBe('new');
  });

  it('sets, enables and de-duplicates enabled maps per source', () => {
    let config = upsertSource(upsertSource(EMPTY_CLOUD_CONFIG, firebase), liberec);
    config = setEnabledMaps(config, 'demo', ['a', 'b', 'a']);
    config = enableMap(config, 'demo', 'b');
    config = enableMap(config, 'unknown', 'z');
    expect(findSource(config, 'demo')?.enabledMapIds).toEqual(['a', 'b']);
    expect(findSource(config, 'liberec')?.enabledMapIds).toEqual([]);
  });

  it('removes a source', () => {
    const config = upsertSource(upsertSource(EMPTY_CLOUD_CONFIG, firebase), liberec);
    expect(removeSource(config, 'demo').sources.map((s) => s.id)).toEqual(['liberec']);
  });
});

describe('applyUrlConfig', () => {
  it('adds a source for link credentials and enables the map on it', () => {
    const config = applyUrlConfig(EMPTY_CLOUD_CONFIG, { firebase, mapId: 'm1' });
    expect(config.sources).toEqual([{ id: 'demo', label: 'demo', firebase, enabledMapIds: ['m1'] }]);
  });

  it('enables a map id-only link on the only source, and ignores it with several or none', () => {
    const one = upsertSource(EMPTY_CLOUD_CONFIG, firebase);
    expect(applyUrlConfig(one, { mapId: 'm1' }).sources[0]?.enabledMapIds).toEqual(['m1']);
    expect(applyUrlConfig(EMPTY_CLOUD_CONFIG, { mapId: 'm1' })).toEqual(EMPTY_CLOUD_CONFIG);
    const two = upsertSource(one, liberec);
    expect(applyUrlConfig(two, { mapId: 'm1' })).toEqual(two);
  });

  it('puts the map on the source of the link credentials when there are several', () => {
    const two = upsertSource(upsertSource(EMPTY_CLOUD_CONFIG, firebase), liberec);
    const applied = applyUrlConfig(two, { firebase: liberec, mapId: 'm9' });
    expect(findSource(applied, 'liberec')?.enabledMapIds).toEqual(['m9']);
    expect(findSource(applied, 'demo')?.enabledMapIds).toEqual([]);
  });
});
