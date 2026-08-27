import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_LIMIT = 2_097_152n;

class UsageError extends Error {}

const usage = `Usage: node scripts/check-package-size.mjs [directory] [limit-in-bytes]
       node scripts/check-package-size.mjs [directory] --limit <limit-in-bytes>`;

function parseLimit(value) {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new UsageError('limit must be a non-negative integer');
  }

  return BigInt(value);
}

function parseArguments(args) {
  let directory;
  let limitValue;
  let limitWasProvided = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--help' || argument === '-h') {
      return { help: true };
    }

    if (argument === '--limit') {
      if (limitWasProvided || index + 1 >= args.length) {
        throw new UsageError('missing or duplicate --limit value');
      }
      limitValue = args[index + 1];
      limitWasProvided = true;
      index += 1;
      continue;
    }

    if (argument.startsWith('--limit=')) {
      if (limitWasProvided) {
        throw new UsageError('duplicate --limit value');
      }
      limitValue = argument.slice('--limit='.length);
      limitWasProvided = true;
      continue;
    }

    if (argument.startsWith('-')) {
      throw new UsageError(`unknown option ${argument}`);
    }

    if (directory === undefined) {
      directory = argument;
      continue;
    }

    if (limitWasProvided || limitValue !== undefined) {
      throw new UsageError('duplicate limit value');
    }
    limitValue = argument;
    limitWasProvided = true;
  }

  return {
    directory: directory ?? 'dist',
    limit: parseLimit(limitValue ?? DEFAULT_LIMIT.toString()),
    help: false,
  };
}

async function getLogicalSize(directory) {
  const root = path.resolve(directory);
  const rootStats = await lstat(root, { bigint: true });
  if (!rootStats.isDirectory()) {
    throw new Error('target is not a directory');
  }

  let size = 0n;
  const pendingDirectories = [root];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileStats = await lstat(entryPath, { bigint: true });
      if (fileStats.isFile()) {
        size += fileStats.size;
      }
    }
  }

  return size;
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`Package size check usage error: ${error.message}`);
    console.error(usage);
    return 2;
  }

  if (options.help) {
    console.log(usage);
    return 0;
  }

  let size;
  try {
    size = await getLogicalSize(options.directory);
  } catch {
    console.error('Package size check failed: target directory could not be inspected.');
    return 2;
  }

  if (size >= options.limit) {
    console.error(
      `Package size check failed: ${size} bytes is at or above the ${options.limit} bytes limit.`,
    );
    return 1;
  }

  console.log(`Package size check passed: ${size} bytes (limit: ${options.limit} bytes).`);
  return 0;
}

process.exitCode = await main();
