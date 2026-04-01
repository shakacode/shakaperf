/**
 * Wraps an error thrown inside a test function (_testFn / onBefore) and
 * carries the last annotation label that was active at the time of failure.
 */
export default class AnnotatedError extends Error {
  lastAnnotation: string;

  constructor (cause: Error, lastAnnotation: string) {
    super(cause.message);
    this.name = 'AnnotatedError';
    this.lastAnnotation = lastAnnotation;
    // Preserve the original stack for debugging
    this.stack = cause.stack;
  }
}
