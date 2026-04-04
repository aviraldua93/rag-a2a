import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';

/**
 * A document freshly loaded from disk, before chunking or embedding.
 */
export interface RawDocument {
  /** Deterministic hash of the file path. */
  id: string;
  /** Full text content of the file. */
  content: string;
  metadata: {
    /** Absolute file path. */
    source: string;
    /** Base file name (e.g. "README.md"). */
    filename: string;
    /** File extension including the dot (e.g. ".md"). */
    extension: string;
    /** File size in bytes. */
    sizeBytes: number;
    /** ISO-8601 timestamp of when the file was loaded. */
    loadedAt: string;
  };
}

/** Extensions supported out-of-the-box. */
const SUPPORTED_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.py',
]);

/** Directories to skip during recursive walks. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__']);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a single file from disk and return a {@link RawDocument}.
 *
 * @throws If the file does not exist or its extension is not supported.
 */
export async function loadFile(filePath: string): Promise<RawDocument> {
  const absPath = resolve(filePath);
  const ext = extname(absPath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file extension: ${ext} (${absPath})`);
  }

  const file = Bun.file(absPath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`File not found: ${absPath}`);
  }

  const content = await file.text();

  return {
    id: simpleHash(absPath),
    content,
    metadata: {
      source: absPath,
      filename: basename(absPath),
      extension: ext,
      sizeBytes: file.size,
      loadedAt: new Date().toISOString(),
    },
  };
}

/**
 * Recursively load every supported file under {@link dirPath}.
 *
 * @param dirPath  Root directory to walk.
 * @param extensions  Optional allowlist of extensions (e.g. `['.md', '.ts']`).
 *                    Defaults to all {@link SUPPORTED_EXTENSIONS}.
 */
export async function loadDirectory(
  dirPath: string,
  extensions?: string[],
): Promise<RawDocument[]> {
  const absDir = resolve(dirPath);
  const allowedExts = extensions
    ? new Set(extensions.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)))
    : SUPPORTED_EXTENSIONS;

  const docs: RawDocument[] = [];
  await walkDirectory(absDir, allowedExts, docs);
  return docs;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Recursively walk a directory, collecting RawDocuments. */
async function walkDirectory(
  dir: string,
  allowedExts: Set<string>,
  out: RawDocument[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // Silently skip unreadable directories.
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);

    let info;
    try {
      info = await stat(fullPath);
    } catch {
      continue;
    }

    if (info.isDirectory()) {
      await walkDirectory(fullPath, allowedExts, out);
    } else if (info.isFile()) {
      const ext = extname(entry).toLowerCase();
      if (!allowedExts.has(ext)) continue;

      try {
        const doc = await loadFile(fullPath);
        out.push(doc);
      } catch {
        // Skip individual files that fail to load.
      }
    }
  }
}

/**
 * Fast, deterministic string → hex-string hash (djb2).
 * Not cryptographic, but perfectly fine for document IDs.
 */
function simpleHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
