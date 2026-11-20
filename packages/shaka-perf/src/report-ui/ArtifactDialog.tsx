/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ComponentProps, ReactNode } from 'react';
import { ArtifactMetadata } from './ArtifactMetadata';
import { Dialog } from './Dialog';
import { useTestCard } from './test-card-context';

type ArtifactDialogProps =
  Omit<ComponentProps<typeof Dialog>, 'open' | 'meta'> &
  ComponentProps<typeof ArtifactMetadata> & {
    title: ReactNode;
  };

export function ArtifactDialog({ title, executionDetails, fields, ...dialogProps }: ArtifactDialogProps) {
  const { test } = useTestCard();
  return (
    <Dialog
      {...dialogProps}
      open
      title={<span className="ui-dialog__title-text">{title} · {test.name}</span>}
      meta={<ArtifactMetadata executionDetails={executionDetails} fields={fields} />}
    />
  );
}
