/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-explicit-any */

import chalk from "chalk";
import { createHash } from "crypto";

/**
 * Merge the contents of the right object into the left. Simply replace numbers, strings, arrays
 * and recursively call this function with objects.
 *
 * Note that typeof null == 'object'
 *
 * @param left - Destination object
 * @param right - Content of this object takes precedence
 */
export function mergeLeft(
  left: { [key: string]: any },
  right: { [key: string]: any }
): { [key: string]: any } {
  Object.keys(right).forEach((key) => {
    const leftValue = left[key];
    const rightValue = left[key];
    const matchingObjectType =
      typeof leftValue === "object" && typeof rightValue === "object";
    const isOneArray = Array.isArray(leftValue) || Array.isArray(rightValue);

    if (matchingObjectType && (left[key] || right[key]) && !isOneArray) {
      mergeLeft(left[key], right[key]);
    } else {
      left[key] = right[key];
    }
  });

  return left;
}

export function convertMicrosecondsToMS(ms: string | number): number {
  ms = typeof ms === "string" ? parseInt(ms, 10) : ms;
  return Math.floor(ms * 100) / 100000;
}

export function convertMSToMicroseconds(ms: string | number): number {
  ms = typeof ms === "string" ? parseInt(ms, 10) : ms;
  return Math.floor(ms * 1000);
}

/**
 * "name" is expected to be a titlecased string. We want something the user can type easily so the passed string
 * is converted into lowercased words dasherized. Any extra "/" will also be removed.
 *
 * @param str - String to be converted to dasherized case
 */
export function convertToTypable(name: string): string {
  const split = name.split(" ");
  const lowercasedWords = split.map((word) =>
    word.toLowerCase().replace(/\//g, "")
  );
  return lowercasedWords.join("-");
}

export function toNearestHundreth(n: number): number {
  return Math.round(n * 100) / 100;
}

export const chalkScheme = {
  white: chalk.rgb(255, 255, 255),
  warning: chalk.rgb(255, 174, 66),
  header: chalk.rgb(255, 255, 255),
  regress: chalk.rgb(239, 100, 107),
  neutral: chalk.rgb(225, 225, 225),
  significant: chalk.rgb(0, 191, 255),
  imprv: chalk.rgb(135, 197, 113),
  phase: chalk.rgb(225, 225, 225),
  faint: chalk.rgb(80, 80, 80),
  checkmark: chalk.rgb(133, 153, 36)(`✔`),
  blackBgGreen: chalk.green.bgGreen,
  blackBgRed: chalk.rgb(239, 100, 107).bgRed,
  blackBgBlue: chalk.rgb(24, 132, 228).bgRgb(24, 132, 228),
  blackBgYellow: chalk.rgb(255, 174, 66).bgRgb(255, 174, 66),
  tbBranding: {
    lime: chalk.rgb(199, 241, 106),
    blue: chalk.rgb(24, 132, 228),
    aqua: chalk.rgb(56, 210, 211),
    dkBlue: chalk.rgb(10, 45, 70),
    grey: chalk.rgb(153, 153, 153),
  },
};

export function logHeading(
  heading: string,
  headingType: "log" | "warn" | "alert" = "log"
): void {
  switch (headingType) {
    case "log":
      console.log(
        `\n${chalkScheme.blackBgBlue(
          `    ${chalkScheme.white(heading)}    `
        )}\n`
      );
      break;
    case "warn":
      console.log(
        `\n${chalkScheme.blackBgYellow(
          `    ${chalkScheme.white("WARNING")}    `
        )} ${chalkScheme.warning(heading)}\n`
      );
      break;
    case "alert":
      console.log(
        `\n${chalkScheme.blackBgRed(
          `    ${chalkScheme.white("! ALERT")}    `
        )} ${chalk.red(heading)}\n`
      );
      break;
  }
}

export function timestamp(): number {
  return new Date().getTime();
}

export function durationInSec(endTime: number, startTime: number): number {
  return Math.round((endTime - startTime) / 1000);
}

export function secondsToTime(sec: number): string {
  const m = Math.floor((sec % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");

  return `${m}m:${s}s`;
}

export function md5sum(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

/**
 * Function to introduce a wait
 *
 * @param ms - How many milliseconds to wait
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
