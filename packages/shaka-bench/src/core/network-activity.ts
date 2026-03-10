import chalk from 'chalk';
import { execSync } from 'child_process';
import type { LighthouseResult } from 'lighthouse';
import { writeFileSync } from 'node:fs';

interface DownloadsSizesKB {
  [filename: string]: number[];
}

const downloadsSizes: {
  [name: string]: DownloadsSizesKB;
} = {};

const saveDownloadsSizes = (
  downloadsSizes: DownloadsSizesKB,
  path: string
): void => {
  const downloads = Object.keys(downloadsSizes);

  downloads.sort((a, b) => a.localeCompare(b));

  const lines = downloads.map((url) => {
    const averageSize: number =
      downloadsSizes[url].reduce((partialSum, a) => partialSum + a, 0) /
      downloadsSizes[url].length;

    return `${url}\n⤷ ${(averageSize / 1024).toFixed(2)} KB. Downloaded ${
      downloadsSizes[url].length
    } times`;
  });

  writeFileSync(path, lines.join('\n') + '\n');
};

export function compareNetworkActivity(): void {
  const [controlReport, experimentReport] = Object.keys(downloadsSizes).map(
    (name) => {
      const reportFilePath = `${name}_network_activity.txt`;
      saveDownloadsSizes(downloadsSizes[name], reportFilePath);

      return {
        path: reportFilePath,
        totalSize: Object.values(downloadsSizes[name]).reduce(
          (partialSum, sizes) =>
            partialSum +
            sizes.reduce((partialSum, size) => partialSum + size, 0),
          0
        )
      };
    }
  );

  const totalSizeDiffKb =
    (experimentReport.totalSize - controlReport.totalSize) / 1024;

  if (totalSizeDiffKb != 0) {
    if (totalSizeDiffKb > 0) {
      console.log(
        chalk.red(
          `Total downloads size increased by ${totalSizeDiffKb.toFixed(2)} KB`
        )
      );
    } else {
      console.log(
        chalk.green(
          `Total downloads size decreased by ${-totalSizeDiffKb.toFixed(2)} KB`
        )
      );
    }
  }

  try {
    execSync(
      `git --no-pager  diff --no-index ${controlReport.path} ${experimentReport.path}`,
      { stdio: 'inherit' }
    );
  } catch {
    // do nothing
  }
}

export const updateDownloadedSizes = (
  lighthouseResult: LighthouseResult,
  namePrefix: string,
  url: string
): number => {
  let totalSizeBytes = 0;
  downloadsSizes[namePrefix] = downloadsSizes[namePrefix] || {};
  const devtoolsLogs = lighthouseResult.artifacts.devtoolsLogs?.defaultPass;

  devtoolsLogs?.forEach((requestWillBeSentEntry) => {
    if (
      requestWillBeSentEntry.method === 'Network.requestWillBeSent' &&
      requestWillBeSentEntry.params.request
    ) {
      const parsedPageUrl = new URL(url);

      let requestUrl = requestWillBeSentEntry.params.request.url.replace(
        parsedPageUrl.origin,
        ''
      );
      if (
        requestUrl === '/graphql' &&
        requestWillBeSentEntry.params.request.postData
      ) {
        const postData = JSON.parse(
          requestWillBeSentEntry.params.request.postData
        );
        if (postData.operationName) {
          requestUrl =
            '/graphql?operationName="' + postData.operationName + '"';
        }
      }
      devtoolsLogs.find((loadingFinishedEntry) => {
        if (
          loadingFinishedEntry.method === 'Network.loadingFinished' &&
          loadingFinishedEntry.params.requestId ===
            requestWillBeSentEntry.params.requestId
        ) {
          const size = loadingFinishedEntry.params.encodedDataLength;
          if (!downloadsSizes[namePrefix][requestUrl]) {
            downloadsSizes[namePrefix][requestUrl] = [];
          }
          if (size) {
            downloadsSizes[namePrefix][requestUrl].push(size);
            totalSizeBytes += size;
          }
        }
      });
    }
  });

  return totalSizeBytes;
};
