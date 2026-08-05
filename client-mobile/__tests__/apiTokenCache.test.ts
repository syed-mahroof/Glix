import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components', 'lib', 'store', 'widgets'];
const SKIP_FILE = path.join(ROOT, 'lib', 'api.ts');
const SECURE_STORE_CALL = /SecureStore\.(get|set|delete)ItemAsync/;

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

describe('access/refresh token cache invariant (C2)', () => {
  it('confines every SecureStore access/refresh-token call to lib/api.ts', () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) {
      const abs = path.join(ROOT, dir);
      if (fs.existsSync(abs)) walk(abs, files);
    }

    const offenders = files
      .filter((f) => f !== SKIP_FILE)
      .filter((f) => SECURE_STORE_CALL.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));

    expect(offenders).toEqual([]);
  });
});

describe('getAccessToken / setTokens / clearTokens', () => {
  const mockGetItemAsync = jest.fn();
  const mockSetItemAsync = jest.fn().mockResolvedValue(undefined);
  const mockDeleteItemAsync = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('expo-secure-store', () => ({
      getItemAsync: mockGetItemAsync,
      setItemAsync: mockSetItemAsync,
      deleteItemAsync: mockDeleteItemAsync,
    }));
  });

  it('single-flights concurrent reads into one keychain call', async () => {
    mockGetItemAsync.mockResolvedValue('tok-1');
    const { getAccessToken } = require('../lib/api');

    const results = await Promise.all([
      getAccessToken(),
      getAccessToken(),
      getAccessToken(),
      getAccessToken(),
    ]);

    expect(results).toEqual(['tok-1', 'tok-1', 'tok-1', 'tok-1']);
    expect(mockGetItemAsync).toHaveBeenCalledTimes(1);

    // A further sequential call after the cache is warm costs nothing more.
    await getAccessToken();
    await getAccessToken();
    expect(mockGetItemAsync).toHaveBeenCalledTimes(1);
  });

  it('does not poison the cache on a rejected read', async () => {
    mockGetItemAsync.mockRejectedValueOnce(new Error('SecureStore timeout'));
    const { getAccessToken } = require('../lib/api');

    await expect(getAccessToken()).rejects.toThrow('SecureStore timeout');

    mockGetItemAsync.mockResolvedValueOnce('tok-2');
    await expect(getAccessToken()).resolves.toBe('tok-2');
    expect(mockGetItemAsync).toHaveBeenCalledTimes(2);
  });

  it('setTokens updates the cache synchronously, before the SecureStore write resolves', async () => {
    let resolveWrite: () => void = () => {};
    mockSetItemAsync.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      })
    );
    const { getAccessToken, setTokens } = require('../lib/api');

    const writePromise = setTokens('new-token', 'new-refresh');
    // Cache already reflects the new token even though the write hasn't
    // resolved yet — this is what makes refresh-token rotation correct.
    await expect(getAccessToken()).resolves.toBe('new-token');
    expect(mockGetItemAsync).not.toHaveBeenCalled();

    resolveWrite();
    await writePromise;
  });

  it('clearTokens marks the cache definitively empty, skipping SecureStore on read', async () => {
    const { getAccessToken, clearTokens } = require('../lib/api');
    await clearTokens();

    await expect(getAccessToken()).resolves.toBeNull();
    expect(mockGetItemAsync).not.toHaveBeenCalled();
  });
});
