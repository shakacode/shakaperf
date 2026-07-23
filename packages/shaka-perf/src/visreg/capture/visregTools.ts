/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { VisregTools } from '../core/types';
import type { PlaywrightPage } from '../core/types';

declare global {
  interface Window {
    _visregTools: VisregTools;
  }
}

'use strict';
export default (target: PlaywrightPage) => {
  return target.evaluate(() => {
    if (window._visregTools) {
      return false;
    }

    window._visregTools = {
      /**
       * Take an array of selector names and return and array of *all* matching selectors.
       * For each selector name, If more than 1 selector is matched, proceeding matches are
       * tagged with an additional `__n` class.
       *
       * @return {[string]} [array of expanded selectors]
       * @param selectors
       */
      expandSelectors: function (selectors) {
        if (!Array.isArray(selectors)) {
          selectors = selectors.split(',');
        }
        return selectors.reduce(function (acc: string[], selector: string) {
          if (selector === 'body' || selector === 'viewport') {
            return acc.concat([selector]);
          }
          if (selector === 'document') {
            return acc.concat(['document']);
          }
          const qResult = document.querySelectorAll(selector);

          // pass-through any selectors that don't match any DOM elements
          if (!qResult.length) {
            return acc.concat(selector);
          }

          const expandedSelector = ([] as Element[]).slice.call(qResult)
            .map(function (element: Element, expandedIndex: number) {
              if (element.classList.contains('__86d')) {
                return '';
              }
              if (!expandedIndex) {
                // only first element is used for screenshots -- even if multiple instances exist.
                // therefore index 0 does not need extended qualification.
                return selector;
              }
              // create index partial
              const indexPartial = '__n' + expandedIndex;
              // update all matching selectors with additional indexPartial class
              element.classList.add(indexPartial);
              // return array of fully-qualified classnames
              return selector + '.' + indexPartial;
            });
          // concat arrays of fully-qualified classnames
          return acc.concat(expandedSelector);
        }, [] as string[]).filter(function (selector: string) {
          return selector !== '';
        });
      },
      /**
       * is the selector element visible?
       * @param  {[type]}  selector [a css selector str]
       * @return {Boolean}          [is it visible? true or false]
       */
      isVisible: function (selector) {
        if (selector === 'body' || selector === 'document' || selector === 'viewport') {
          return true;
        } else if (window._visregTools.exists(selector)) {
          const element = document.querySelector(selector)!;
          const style = window.getComputedStyle(element);
          return (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
        }
        return false;
      },
      /**
       * does the selector element exist?
       * @param  {[type]} selector [a css selector str]
       * @return {[type]}          [returns count of found matches -- 0 for no matches]
       */
      exists: function (selector) {
        if (selector === 'body' || selector === 'document' || selector === 'viewport') {
          return 1;
        }
        return document.querySelectorAll(selector).length;
      }
    };

    console.info('VisregTools have been installed.');
    return true;
  });
};
