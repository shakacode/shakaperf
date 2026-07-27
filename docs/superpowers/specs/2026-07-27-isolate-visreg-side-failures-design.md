# Isolate Visreg Side Failures

## Goal

Preserve the behavior introduced by commit
`6cb13c6d9c48ea8f6977ce5a1c8e3b4a872c0585` while making side ownership
explicit. An error from the control side must never receive the experiment
side's latest annotation or failure screenshot, and vice versa.

The refactor covers both sources of cross-side state:

- test annotations stored in `AsyncLocalStorage`;
- failure screenshots captured while control and experiment operations run
  concurrently.

Retry and comparison behavior is unchanged.

## Annotation Isolation

Every call to `runWithTestAnnotationContext` creates a fresh annotation store,
even when it runs inside a stage-level annotation context. The context catches
errors thrown by its body and attaches only its own latest annotation to the
original error.

This gives each concurrent test body an independent annotation slot without
requiring callers to know whether an outer annotation context exists.

## Side Failure Model

Introduce an internal visreg error type that records:

- the failing side (`control` or `experiment`);
- the original error as its `cause`;
- the failure screenshot path when capture succeeds.

The wrapper keeps the original message. Cause-chain consumers continue to find
the original stack and test annotation.

Side identity belongs to the failure, not to the browser-side factory. The
existing `ComparisonSide` interface and `createComparisonSide` signature
therefore remain concerned only with browser resources.

## Paired Operation Flow

`runCompareAttempts` uses one local helper for paired control and experiment
operations:

1. Run both operations concurrently under their existing log prefixes.
2. If an operation throws, capture a screenshot from that operation's live
   page and wrap the cause in a side failure.
3. Wait for both operations to settle before disposing either browser context.
4. If both fail, log the control failure and throw the experiment failure.
   Otherwise throw the one failure.
5. Return both successful values as a tuple.

The same helper handles page preparation and selector screenshot capture.
Resolved `null` selector captures are converted into a side failure after the
pair settles. If both sides are missing the selector, the experiment side is
the primary failure because it is the side under test.

Errors outside a side operation default to the experiment page while it is
alive. Errors during side creation are attributed to the requested side but do
not attempt a screenshot because no usable page is available.

## Stage Artifact Selection

The visreg stage walks the error cause chain for side-failure metadata.

- When an exact screenshot path exists, it inlines that file.
- When only a side is known, it searches new screenshots from that side's
  artifact directory only.
- When no side is known, it retains the existing newest-screenshot fallback
  across both directories for engine failures that cannot be attributed.

Screenshot capture and metadata lookup are best effort. Their failure never
replaces the original comparison error.

## Cleanup

Browser contexts are disposed after paired operations settle. A disposal
failure never prevents propagation of the original comparison failure.

## Tests

Regression tests cover:

- concurrent annotation bodies attach their own final annotation;
- preparation failure captures and reports only the failing side;
- selector screenshot failure captures and reports only the failing side;
- simultaneous failures prefer experiment and log control;
- failed failure-screenshot capture preserves side attribution and the original
  cause;
- side creation failure cannot inherit the other side's screenshot;
- stage artifact lookup follows cause chains and never crosses to the other
  side when side metadata is present.

Focused tests run through the package Jest command. Final verification uses the
repository's `.agents/bin/validate` entry point.
