/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Audit, Gatherer } from 'lighthouse';
import type * as LH from 'lighthouse/types/lh.js';
import {
  collectImageResolutionMeasurements,
  imageMeasurementPageHelpers,
  evaluateImageResolution,
  type ImageResolutionConfig,
  type ImageResolutionResult,
} from './image-resolution';
import { classifyImageSources, isVectorImageType } from './image-source-type';

declare module 'lighthouse/types/artifacts.js' {
  interface GathererArtifacts {
    ShakaImageResolution: ImageResolutionResult;
  }
}

export const IMAGE_RESOLUTION_CATEGORY = 'shaka-images';

class ImageResolutionGatherer extends Gatherer {
  meta: LH.Gatherer.GathererMeta = { supportedModes: ['navigation'] };
  private rasterUrls = new Set<string>();
  private redirects = new Map<string, Set<string>>();
  private result?: ImageResolutionResult;

  constructor(private readonly config: ImageResolutionConfig) {
    super();
  }

  private onRequest = ({ requestId, request, redirectResponse }: LH.Crdp.Network.RequestWillBeSentEvent) => {
    if (!redirectResponse) return;
    const urls = this.redirects.get(requestId) ?? new Set<string>();
    urls.add(redirectResponse.url);
    urls.add(request.url);
    this.redirects.set(requestId, urls);
  };
  private onResponse = ({ requestId, response }: LH.Crdp.Network.ResponseReceivedEvent) => {
    // currentSrc retains the requested URL, even when the bitmap came through redirects.
    const urls = this.redirects.get(requestId) ?? new Set<string>();
    urls.add(response.url);
    // Every response that is not SVG counts. Only <img> URLs are looked up, and an <img> decodes images only.
    const raster = !isVectorImageType(response.mimeType);
    for (const url of urls) {
      if (raster) this.rasterUrls.add(url);
      else this.rasterUrls.delete(url);
    }
    this.redirects.delete(requestId);
  };

  startInstrumentation({ driver }: LH.Gatherer.Context): void {
    driver.defaultSession.on('Network.requestWillBeSent', this.onRequest);
    driver.defaultSession.on('Network.responseReceived', this.onResponse);
  }

  async stopInstrumentation({ driver }: LH.Gatherer.Context): Promise<void> {
    // This phase follows the end of tracing and precedes gatherers that alter the page.
    try {
      const measurements = await driver.executionContext.evaluate(collectImageResolutionMeasurements, {
        args: [], deps: imageMeasurementPageHelpers, useIsolation: true,
      });
      const classifiedImages = classifyImageSources(measurements, this.rasterUrls);
      this.result = evaluateImageResolution(classifiedImages, this.config);
    } finally {
      driver.defaultSession.off('Network.requestWillBeSent', this.onRequest);
      driver.defaultSession.off('Network.responseReceived', this.onResponse);
      this.redirects.clear();
    }
  }

  getArtifact(): ImageResolutionResult {
    if (!this.result) throw new Error('Image resolution measurements were not collected.');
    return this.result;
  }
}

function formatPixelDimensions(width?: number, height?: number): string {
  return width && height ? `${Math.ceil(width)} × ${Math.ceil(height)}` : 'Unknown';
}

class ImageResolutionAudit extends Audit {
  static get meta(): LH.Audit.Meta {
    return {
      id: 'shaka-image-resolution', title: 'Image resolution matches its displayed size',
      failureTitle: 'Images have insufficient or excessive resolution',
      description: 'Checks the currently selected images at their current object-fit and screen pixel density. ' +
        'Unknown images could not be measured; sufficient resolution does not guarantee a sharp source image.',
      requiredArtifacts: ['ShakaImageResolution'],
    };
  }

  static audit(artifacts: LH.Artifacts, { options }: LH.Audit.Context): LH.Audit.Product {
    const result = artifacts.ShakaImageResolution;
    const findings = result.undersized + result.oversized;
    return {
      score: findings ? 0 : result.unknown ? null : 1,
      ...(findings === 0 && result.unknown > 0 ? { scoreDisplayMode: 'informative' as const } : {}),
      notApplicable: result.images.length === 0,
      displayValue: `${result.undersized} undersized, ${result.oversized} oversized, ${result.unknown} unknown. ` +
        `Acceptable source/required pixel ratio: ${options.minRatio} to ${options.maxRatio}.`,
      details: Audit.makeTableDetails([
        { key: 'url', valueType: 'url', label: 'Image', subItemsHeading: { key: 'resolution', valueType: 'text' } },
      ], result.images.filter(image => image.status !== 'sufficient').map(image => ({
        url: image.src,
        subItems: { type: 'subitems', items: [
          { resolution: `${image.label} · ${image.status} · object-fit: ${image.fit}` },
          { resolution: `Source: ${formatPixelDimensions(image.sourceWidth, image.sourceHeight)} px; required: ${formatPixelDimensions(image.requiredWidth, image.requiredHeight)} px` },
          { resolution: image.reason ?? `${image.ratio!.toFixed(2)}× required resolution` },
        ] },
      }))),
    };
  }
}

export function imageResolutionLighthouseConfig(config: ImageResolutionConfig): LH.Config {
  return {
    extends: 'lighthouse:default',
    artifacts: [{ id: 'ShakaImageResolution', gatherer: { instance: new ImageResolutionGatherer(config) } }],
    audits: [{ implementation: ImageResolutionAudit, options: { minRatio: config.minRatio, maxRatio: config.maxRatio } }],
    categories: { [IMAGE_RESOLUTION_CATEGORY]: {
      title: 'Image resolution', auditRefs: [{ id: 'shaka-image-resolution', weight: 1 }],
    } },
  };
}
