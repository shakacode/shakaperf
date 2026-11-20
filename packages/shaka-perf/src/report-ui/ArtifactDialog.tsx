/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ComponentProps, ReactNode } from 'react';
import { ArtifactDialogMetadata } from './ArtifactDialogMetadata';
import { Dialog } from './Dialog';
import { useTestCard } from './TestCardProvider';

type ArtifactDialogProps =
  Omit<ComponentProps<typeof Dialog>, 'open' | 'meta'> &
  ComponentProps<typeof ArtifactDialogMetadata> & {
    title: ReactNode;
  };

export function ArtifactDialog({ title, executionDetails, fields, ...dialogProps }: ArtifactDialogProps) {
  const { test } = useTestCard();
  return (
    <Dialog
      {...dialogProps}
      open
      title={<span className="ui-dialog__title-text">{title} · {test.name}</span>}
      meta={<ArtifactDialogMetadata executionDetails={executionDetails} fields={fields} />}
    />
  );
}
