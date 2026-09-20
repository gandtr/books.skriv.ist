import 'fake-indexeddb/auto';
import { vi } from 'vitest';
import { File, Blob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
vi.stubGlobal('File', File);
vi.stubGlobal('Blob', Blob);
vi.stubGlobal('crypto', webcrypto);
URL.createObjectURL = vi.fn(() => 'blob:test-resource');
URL.revokeObjectURL = vi.fn();
