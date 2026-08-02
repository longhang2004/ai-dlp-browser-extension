import {
  CLAUDE_ADAPTER_VERSION,
  CHATGPT_ADAPTER_VERSION,
  isAdapterDescriptorClaim,
  type AdapterDescriptor,
} from "@ai-dlp/shared-types";

function freezeDescriptor<const Descriptor extends AdapterDescriptor>(
  descriptor: Descriptor,
): Readonly<Descriptor> {
  Object.freeze(descriptor.origins);
  Object.freeze(descriptor.capabilities);
  return Object.freeze(descriptor);
}

export function assertExecutableAdapterCatalogInvariants(
  entries: readonly AdapterDescriptor[],
): void {
  const adapterIds = new Set<string>();
  const surfaceIds = new Set<string>();
  const origins = new Set<string>();
  const entryPoints = new Set<string>();
  const duplicateOwnership: string[] = [];

  for (const entry of entries) {
    const packagedIdentity =
      entry.adapterId === "chatgpt"
        ? CHATGPT_ADAPTER_DESCRIPTOR
        : entry.adapterId === "claude"
          ? CLAUDE_ADAPTER_DESCRIPTOR
          : null;
    if (
      packagedIdentity === null ||
      !isAdapterDescriptorClaim(packagedIdentity, entry)
    ) {
      throw new Error("Descriptor does not match a packaged adapter identity.");
    }
    if (adapterIds.has(entry.adapterId)) {
      duplicateOwnership.push(`Duplicate adapter ID: ${entry.adapterId}`);
    }
    if (surfaceIds.has(entry.surfaceId)) {
      duplicateOwnership.push(`Duplicate surface ID: ${entry.surfaceId}`);
    }
    adapterIds.add(entry.adapterId);
    surfaceIds.add(entry.surfaceId);

    for (const origin of entry.origins) {
      if (origins.has(origin)) {
        duplicateOwnership.push(`Duplicate origin: ${origin}`);
      }
      origins.add(origin);
    }
    if (entryPoints.has(entry.entryPoint)) {
      duplicateOwnership.push(`Duplicate entry point: ${entry.entryPoint}`);
    }
    entryPoints.add(entry.entryPoint);
  }

  if (duplicateOwnership.length > 0) {
    throw new Error(duplicateOwnership.join("; "));
  }
  if (entries.length !== 2) {
    throw new Error("M2.2 requires exactly two executable adapters.");
  }
}

export const CHATGPT_ADAPTER_DESCRIPTOR = freezeDescriptor({
  adapterId: "chatgpt",
  surfaceId: "chatgpt_web",
  version: CHATGPT_ADAPTER_VERSION,
  trust: "verified",
  origins: ["https://chatgpt.com"],
  capabilities: {
    submissionDetection: "verified",
    promptRead: "verified",
    attachmentDetection: "verified",
    attachmentInspection: "unsupported",
    promptReplacement: "unsupported",
    submissionResume: "verified",
  },
  entryPoint: "content-script.js",
});

export const CLAUDE_ADAPTER_DESCRIPTOR = freezeDescriptor({
  adapterId: "claude",
  surfaceId: "claude_web",
  version: CLAUDE_ADAPTER_VERSION,
  trust: "verified",
  origins: ["https://claude.ai"],
  capabilities: {
    submissionDetection: "verified",
    promptRead: "verified",
    attachmentDetection: "verified",
    attachmentInspection: "unsupported",
    promptReplacement: "unsupported",
    submissionResume: "verified",
  },
  entryPoint: "content-claude.js",
});

const executableAdapterCatalog = [
  CHATGPT_ADAPTER_DESCRIPTOR,
  CLAUDE_ADAPTER_DESCRIPTOR,
] as const;
assertExecutableAdapterCatalogInvariants(executableAdapterCatalog);

export const EXECUTABLE_ADAPTER_CATALOG: readonly AdapterDescriptor[] =
  Object.freeze(executableAdapterCatalog);

export function findExecutableAdapterByOrigin(
  origin: string,
): AdapterDescriptor | null {
  return (
    EXECUTABLE_ADAPTER_CATALOG.find((descriptor) =>
      descriptor.origins.includes(origin),
    ) ?? null
  );
}
