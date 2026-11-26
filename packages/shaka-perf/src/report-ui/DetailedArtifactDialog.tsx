/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useState, type ComponentProps, type ReactNode } from 'react';
import { ArtifactDialogMetadata } from './ArtifactDialogMetadata';
import { ArtifactDialogTitle } from './ArtifactDialogTitle';
import { Dialog } from './Dialog';
import { ImageViewport } from './ImageViewport';
import { PreviewButton } from './PreviewButton';

type DialogProps = ComponentProps<typeof Dialog>;

type DetailedArtifactDialogProps = Pick<DialogProps, 'title' | 'image'> &
  ComponentProps<typeof ArtifactDialogMetadata> & {
    href: string;
    label: string;
    children?: ReactNode;
    body?: ReactNode;
    className?: string;
    variant?: 'preview';
    dialogVariant?: DialogProps['variant'];
  };

export function DetailedArtifactDialog({
  href,
  label,
  title = label,
  children,
  body,
  className,
  variant,
  dialogVariant,
  image,
  ...metadataProps
}: DetailedArtifactDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === 'preview' ? (
        <PreviewButton onClick={() => setOpen(true)}>
          {children ?? label}
        </PreviewButton>
      ) : (
        <button type="button" className={className} onClick={() => setOpen(true)}>
          {children ?? label}
        </button>
      )}
      {open ? (
        <Dialog
          open
          image={image}
          variant={dialogVariant}
          onClose={() => setOpen(false)}
          title={<ArtifactDialogTitle>{title}</ArtifactDialogTitle>}
          meta={<ArtifactDialogMetadata {...metadataProps} />}
        >
          {body ??
            (image ? (
              <ImageViewport>
                <img src={href} alt={label} />
              </ImageViewport>
            ) : (
              <iframe className="artifact-dialog__frame" src={href} title={label} />
            ))}
        </Dialog>
      ) : null}
    </>
  );
}
