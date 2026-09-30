import { describe, expect, it } from 'vitest';
import {
  activeCloudConfig,
  buildConfigLink,
  decodeFirebaseConfig,
  encodeFirebaseConfig,
  hasUrlConfig,
  mergeStoredCloudConfig,
  parseFirebaseSnippet,
  parseStoredCloudConfig,
  parseUrlConfig,
  stripConfigParams,
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

describe('activeCloudConfig', () => {
  it('is null without Firebase credentials, which keeps the app purely local', () => {
    expect(activeCloudConfig({})).toBeNull();
    expect(activeCloudConfig({ mapId: 'm1' })).toBeNull();
  });

  it('returns the credentials with or without a map id', () => {
    expect(activeCloudConfig({ firebase })).toEqual({ firebase });
    expect(activeCloudConfig({ firebase, mapId: 'm1' })).toEqual({ firebase, mapId: 'm1' });
  });
});

describe('mergeStoredCloudConfig', () => {
  it('lets incoming values win and keeps the rest', () => {
    expect(mergeStoredCloudConfig({ firebase, mapId: 'old' }, { mapId: 'new' })).toEqual({
      firebase,
      mapId: 'new',
    });
    expect(mergeStoredCloudConfig({ mapId: 'old' }, { firebase })).toEqual({ firebase, mapId: 'old' });
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

describe('parseStoredCloudConfig', () => {
  it('validates persisted data', () => {
    expect(parseStoredCloudConfig({ firebase, mapId: 'm1' })).toEqual({ firebase, mapId: 'm1' });
    expect(parseStoredCloudConfig({ mapId: 'a/b' })).toBeNull();
    expect(parseStoredCloudConfig('nope')).toBeNull();
  });
});
