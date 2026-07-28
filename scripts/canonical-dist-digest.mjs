import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function encodeLength(length) {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(BigInt(length));
  return encoded;
}

async function collectFiles(root, relativeDirectory = "") {
  const directoryPath =
    relativeDirectory === "" ? root : `${root}/${relativeDirectory}`;
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath =
      relativeDirectory === ""
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
    const absolutePath = `${root}/${relativePath}`;
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(
        `Canonical artifacts may contain only regular files and directories: ${relativePath}`,
      );
    }
    if (metadata.isDirectory()) {
      files.push(...(await collectFiles(root, relativePath)));
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error(
        `Canonical artifacts may contain only regular files and directories: ${relativePath}`,
      );
    }
    files.push(relativePath);
  }

  return files;
}

export async function canonicalDirectoryDigest(directory) {
  const root = resolve(directory);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("Canonical artifact root must be a real directory.");
  }

  const relativePaths = await collectFiles(root);
  relativePaths.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  const hash = createHash("sha256");
  for (const relativePath of relativePaths) {
    const pathBytes = Buffer.from(relativePath, "utf8");
    const fileBytes = await readFile(`${root}/${relativePath}`);
    hash.update(encodeLength(pathBytes.length));
    hash.update(pathBytes);
    hash.update(encodeLength(fileBytes.length));
    hash.update(fileBytes);
  }
  return hash.digest("hex");
}

async function main() {
  const directory = process.argv[2] ?? "apps/extension/dist";
  process.stdout.write(`${await canonicalDirectoryDigest(directory)}\n`);
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
