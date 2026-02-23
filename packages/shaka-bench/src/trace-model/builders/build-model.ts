import type { TraceEvent, TraceStreamJson } from '../../trace-event';

import type { TraceModel } from '../types';
import ModelBuilder from './model-builder';

export default function buildModel(
  trace: TraceEvent[] | TraceStreamJson
): TraceModel {
  const builder = new ModelBuilder();
  return builder.build(trace);
}
