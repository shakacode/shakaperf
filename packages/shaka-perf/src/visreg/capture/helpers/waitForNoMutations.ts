import chalk from 'chalk';
import type { ConsoleMessage, Page } from 'playwright';
import { formatLogPrefix, getTestLogSubject } from '../../core/util/testContext';

const DEFAULT_QUIET_MS = 700;
const DEFAULT_TIMEOUT_MS = 30_000;
const LOG_PREFIX = '[waitForNoMutations]';

export interface WaitForNoMutationsOptions {
  /** Debounce window: no mutations for this long = "settled". Default 700 ms. */
  quietMs?: number;
  /** Outer timeout before giving up. Default 30 000 ms. */
  timeout?: number;
}

/**
 * Wait until `document.body` has gone `quietMs` without observable DOM
 * mutations (anything other than a no-op attribute tick on `<body>`).
 * Throws on timeout. When the page is noisy, each mutation batch is logged
 * too (batch size, type breakdown, a three-mutation sample) so it's obvious
 * why the debounce never fires.
 */
export async function waitForNoMutations(
  page: Page,
  {
    quietMs = DEFAULT_QUIET_MS,
    timeout = DEFAULT_TIMEOUT_MS,
  }: WaitForNoMutationsOptions = {},
): Promise<void> {
  const url = page.url();
  const start = Date.now();

  // Forward in-page logs tagged with our prefix to Node stdout so the
  // mutation diagnostics interleave with the node-side messages.
  const logSubject = getTestLogSubject();
  const onPageConsole = (msg: ConsoleMessage) => {
    const text = msg.text();
    if (text.startsWith(LOG_PREFIX)) {
      const rendered = chalk.yellow(text);
      console.log(logSubject ? `${formatLogPrefix(logSubject)}${rendered}` : rendered);
    }
  };
  page.on('console', onPageConsole);

  const settled = page.evaluate(
    ([quietDelay, logPrefix]: readonly [number, string]) => {
      type PromiseResolver = (value: unknown) => void;

      const debounce = (func: PromiseResolver, delay: number) => {
        let timerId: number | undefined;
        return () => {
          clearTimeout(timerId);
          timerId = setTimeout(() => {
            timerId = undefined;
            func(undefined);
          }, delay) as unknown as number;
        };
      };

      const describeNode = (node: Node | null): string => {
        if (!node) return 'null';
        if (node.nodeType === 3) {
          const data = (node.nodeValue ?? '').replace(/\s+/g, ' ').slice(0, 40);
          return `#text"${data}"`;
        }
        if (node.nodeType === 1) {
          const el = node as Element;
          const id = el.id ? `#${el.id}` : '';
          const cls =
            typeof el.className === 'string' && el.className
              ? `.${el.className.split(/\s+/).slice(0, 2).join('.')}`
              : '';
          return `${el.tagName.toLowerCase()}${id}${cls}`;
        }
        return `node<${node.nodeType}>`;
      };
      const describeMutation = (m: MutationRecord): string => {
        const target = describeNode(m.target);
        if (m.type === 'attributes') {
          const newVal = (m.target as Element).getAttribute?.(m.attributeName ?? '') ?? '';
          return `attr ${target} ${m.attributeName}="${newVal.slice(0, 40)}"`;
        }
        if (m.type === 'characterData') return `text ${target}`;
        const added = Array.from(m.addedNodes).slice(0, 2).map(describeNode).join(',');
        const removed = Array.from(m.removedNodes).slice(0, 2).map(describeNode).join(',');
        const parts: string[] = [];
        if (m.addedNodes.length) parts.push(`+${m.addedNodes.length}[${added}]`);
        if (m.removedNodes.length) parts.push(`-${m.removedNodes.length}[${removed}]`);
        return `children ${target} ${parts.join(' ')}`;
      };

      let onActivity: PromiseResolver = () => {};
      const settledPromise = new Promise((resolve) => {
        onActivity = debounce(resolve, quietDelay);
      });

      const observer = new MutationObserver((mutations) => {
        const useful = mutations.filter(
          (m) => !((m.target as HTMLElement).tagName === 'BODY' && m.type === 'attributes'),
        );
        if (useful.length === 0) return;

        const typeCount = { attributes: 0, characterData: 0, childList: 0 };
        for (const m of useful) typeCount[m.type] += 1;
        const sample = useful.slice(0, 3).map(describeMutation).join(' | ');
        console.log(
          `${logPrefix} mutation batch size=${useful.length} ` +
            `attr=${typeCount.attributes} text=${typeCount.characterData} ` +
            `child=${typeCount.childList} :: ${sample}`,
        );
        onActivity(undefined);
      });
      observer.observe(document.body, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });

      onActivity(undefined);
      return settledPromise.then(() => {
        observer.disconnect();
      });
    },
    [quietMs, LOG_PREFIX] as const,
  );

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeout);
  });

  try {
    const outcome = await Promise.race([settled.then(() => 'settled' as const), deadline]);
    const elapsed = Date.now() - start;
    if (outcome === 'settled') {
      console.log(
        chalk.green(`${LOG_PREFIX} quiet for ${quietMs} ms, settled in ${elapsed} ms for ${url}`),
      );
    } else {
      throw new Error(
        `${LOG_PREFIX} timed out after ${timeout} ms for ${url} — DOM never stayed quiet for ${quietMs} ms.`,
      );
    }
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      throw new Error(`${LOG_PREFIX} timed out for ${url}: ${(err as Error).message}`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    page.off('console', onPageConsole);
  }
}
