/*
 * Copyright (c) 2026 ShakaCode LLC.
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
