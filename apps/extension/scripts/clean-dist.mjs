import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { cleanExtensionDist } from "./artifact-reachability.mjs";

async function main() {
  await cleanExtensionDist(process.argv[2] ?? "dist");
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
