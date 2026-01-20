/**
 * Creates text files showing the hierarchical breakdown of modules
 * included in each chunk, useful for understanding bundle composition.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SourceMapGeneratorConfig, ChunkGroupInfo, BundleInfo } from './types';

const UNCATEGORIZED_NAME = 'uncategorized_chunks';

export class SourceMapGenerator {
  private bundlesDir: string;
  private baselineDir: string;

  constructor({ bundlesDir, baselineDir }: SourceMapGeneratorConfig) {
    this.bundlesDir = bundlesDir;
    this.baselineDir = baselineDir;
  }

  formatLabel(label: string): string {
    return label
      .replace(/ /g, '_')
      .replace(/_\+_\d*_modules_\(concatenated\)/g, '+concatenated_modules');
  }

  formatSize(gzipSize?: number): string {
    if (!gzipSize) return '';
    return ` ${(gzipSize / 1024).toFixed(2)} KB`;
  }

  writeSources(bundle: BundleInfo, parents: string[], lines: string[]): void {
    const label = this.formatLabel(bundle.label);
    const sizeString = this.formatSize(bundle.gzipSize);

    const parentsPath = this.buildParentsPath(parents);
    lines.push(`${parentsPath}${label}${sizeString}`);

    if (!bundle.groups) return;

    const updatedParents = [...parents, label];

    for (const group of bundle.groups) {
      if (parents.length === 0) {
        const sortedLines: string[] = [];
        this.writeSources(group, updatedParents, sortedLines);
        sortedLines.sort();
        lines.push(...sortedLines);
      } else {
        this.writeSources(group, updatedParents, lines);
      }
    }
  }

  buildParentsPath(parents: string[]): string {
    if (parents.length === 0) {
      return `./${this.bundlesDir}/`;
    }

    const pathParts = parents.slice(1);
    const pathString = pathParts.join('/');

    return pathString ? `${pathString}/` : '';
  }

  calculateChunksSize(chunkNames: string[], bundlesDictionary: Record<string, BundleInfo>): number {
    return chunkNames.reduce((total, name) => {
      const bundle = bundlesDictionary[name];
      return total + (bundle?.gzipSize || 0);
    }, 0);
  }

  generateSeparator(count: number = 20): string {
    const separator = '='.repeat(200);
    return Array(count).fill(separator).join('\n') + '\n';
  }

  generateChunkGroup(groupName: string, chunkNames: string[], bundlesDictionary: Record<string, BundleInfo>): string {
    const lines: string[] = [];
    const sizeBytes = this.calculateChunksSize(chunkNames, bundlesDictionary);
    const sizeKb = (sizeBytes / 1024).toFixed(2);

    const header = groupName === UNCATEGORIZED_NAME
      ? `Uncategorized Chunks:`
      : `Loadable Component: name=${groupName},`;

    lines.push(`${header} size=${sizeKb} KB, chunksNumber=${chunkNames.length}`);

    for (const chunkName of chunkNames) {
      const bundle = bundlesDictionary[chunkName];
      if (!bundle) continue;

      const sourceLines: string[] = [];
      this.writeSources(bundle, [], sourceLines);
      lines.push(sourceLines.join('\n'));
    }

    lines.push(this.generateSeparator());

    return lines.join('\n');
  }

  getOutputFilePath(filename: string): string {
    return path.join(this.baselineDir, filename);
  }

  generateToFile(
    extendedStatsFile: string,
    outputFilename: string,
    namedChunkGroups: ChunkGroupInfo[],
    uncategorizedChunks: string[]
  ): string | null {
    // Try to read extended stats from the provided path
    const statsPath = path.isAbsolute(extendedStatsFile)
      ? extendedStatsFile
      : path.join(this.bundlesDir, extendedStatsFile);

    if (!fs.existsSync(statsPath)) {
      return null;
    }

    const bundles = JSON.parse(fs.readFileSync(statsPath, 'utf8')) as BundleInfo[];
    const bundlesDictionary: Record<string, BundleInfo> = {};

    for (const bundle of bundles) {
      bundlesDictionary[bundle.label] = bundle;
    }

    const outputPath = this.getOutputFilePath(outputFilename);
    const contentParts: string[] = [];

    contentParts.push('# This file is generated automatically by SourceMapGenerator\n');
    contentParts.push('# It serves as a performance hint showing bundle composition.\n');

    for (const group of namedChunkGroups) {
      contentParts.push(this.generateChunkGroup(group.name, group.assetNames, bundlesDictionary));
    }

    if (uncategorizedChunks.length > 0) {
      contentParts.push(this.generateChunkGroup(UNCATEGORIZED_NAME, uncategorizedChunks, bundlesDictionary));
    }

    fs.writeFileSync(outputPath, contentParts.join(''), 'utf8');

    return outputPath;
  }
}

export { UNCATEGORIZED_NAME };
