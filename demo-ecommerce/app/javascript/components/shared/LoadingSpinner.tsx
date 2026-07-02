/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import React from 'react';
import { CircularProgress, Box } from '@mui/material';

const LoadingSpinner = React.forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <Box
      ref={ref}
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="200px"
    >
      <CircularProgress />
    </Box>
  );
});

export default LoadingSpinner;
