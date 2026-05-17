export const BACKUP_MANIFEST_VERSION = "v1";

export interface BackupManifest {
  version: typeof BACKUP_MANIFEST_VERSION;
  createdAt: string;
  pkg: { name: string; version: string };
  sourceDirs: string[];
  auditCounts: { ontology_audit: number; action_audit: number };
}

export interface BuildManifestInput {
  pkgName: string;
  pkgVersion: string;
  sourceDirs: string[];
  auditCounts: { ontology_audit: number; action_audit: number };
  now?: () => Date;
}

export function buildManifest(input: BuildManifestInput): BackupManifest {
  const now = (input.now ?? (() => new Date()))();
  return {
    version: BACKUP_MANIFEST_VERSION,
    createdAt: now.toISOString(),
    pkg: { name: input.pkgName, version: input.pkgVersion },
    sourceDirs: [...input.sourceDirs],
    auditCounts: { ...input.auditCounts },
  };
}

export function parseManifest(raw: string): BackupManifest {
  const obj = JSON.parse(raw) as Partial<BackupManifest>;
  if (obj.version !== BACKUP_MANIFEST_VERSION) {
    throw new Error(
      `unsupported backup manifest version: ${String(obj.version)}`,
    );
  }
  return obj as BackupManifest;
}
