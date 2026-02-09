/**
 * Extracts named chunk groups and identifies uncategorized chunks
 * from webpack's loadable-stats.json output.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  WebpackStatsReaderConfig,
  ChunkGroupInfo,
  WebpackStatsResult,
  WebpackLoadableStats,
  ChunkGroup,
} from './types';

export class WebpackStatsReader {
  private bundlesDir: string;
  private ignoredBundles: Set<string>;

  constructor({ bundlesDir, ignoredBundles = [] }: WebpackStatsReaderConfig) {
    this.bundlesDir = bundlesDir;
    this.ignoredBundles = new Set(ignoredBundles);
  }

  readJsonFile<T>(filename: string): T {
    const filePath = path.join(this.bundlesDir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  }

  shouldIgnoreBundle(bundleName: string): boolean {
    return this.ignoredBundles.has(bundleName);
  }

  extractAssetNames(chunkGroup: ChunkGroup): string[] {
    if (!chunkGroup.assets || chunkGroup.assets.length === 0) {
      throw new Error(`Loadable component ${chunkGroup.name} has no assets. This can happen happen if you directly import a loadable component bypassing '@loadable/component'. Please either remove the direct import or remove the loadable component.`);
    }
    return chunkGroup.assets.map(asset => asset.name);
  }

  readStats(statsFile: string): WebpackStatsResult {
    const stats = this.readJsonFile<WebpackLoadableStats>(statsFile);
    const namedChunkGroups: ChunkGroupInfo[] = [];
    const allChunkFiles = this.collectAllChunkFiles(stats);

    for (const chunkGroup of Object.values(stats.namedChunkGroups)) {
      if (this.shouldIgnoreBundle(chunkGroup.name)) {
        // Remove ignored bundle's files from allChunkFiles
        this.extractAssetNames(chunkGroup).forEach(name => allChunkFiles.delete(name));
        continue;
      }

      namedChunkGroups.push({
        name: chunkGroup.name,
        assetNames: this.extractAssetNames(chunkGroup),
      });
    }

    return { namedChunkGroups, allChunkFiles };
  }

  collectAllChunkFiles(stats: WebpackLoadableStats): Set<string> {
    const files = new Set<string>();
    for (const chunk of stats.chunks) {
      for (const file of chunk.files) {
        files.add(file);
      }
    }
    return files;
  }

  /** Chunks not in any named chunk group. */
  findUncategorizedChunks(allChunkFiles: Set<string>, namedChunkGroups: ChunkGroupInfo[]): string[] {
    const categorizedFiles = new Set<string>();

    for (const group of namedChunkGroups) {
      for (const assetName of group.assetNames) {
        categorizedFiles.add(assetName);
      }
    }

    const uncategorized: string[] = [];
    for (const file of allChunkFiles) {
      if (!categorizedFiles.has(file)) {
        uncategorized.push(file);
      }
    }

    return uncategorized;
  }
}
