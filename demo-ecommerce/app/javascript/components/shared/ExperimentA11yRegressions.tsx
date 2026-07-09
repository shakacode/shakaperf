/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';

const sampleImage =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="72" viewBox="0 0 120 72"%3E%3Crect width="120" height="72" fill="%23667eea"/%3E%3Ccircle cx="36" cy="36" r="18" fill="%23ffffff"/%3E%3Cpath d="M68 24h36v8H68zm0 16h28v8H68z" fill="%23ffffff"/%3E%3C/svg%3E';

/**
 * Intentional experiment-only accessibility regressions used to exercise the
 * compare report's "new in experiment" UI.
 */
const ExperimentA11yRegressions: React.FC = () => (
  <Box
    data-cy="experiment-a11y-regressions"
    sx={{
      bgcolor: 'white',
      border: '1px dashed #b91c1c',
      display: 'grid',
      gap: 1.5,
      mb: 4,
      p: 2,
    }}
  >
    <Typography variant="subtitle2" component="p" sx={{ color: '#eeeeee', bgcolor: '#ffffff' }}>
      Limited-time members-only preview
    </Typography>

    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
      <button
        type="button"
        style={{ width: 36, height: 36, border: '1px solid #667eea', background: '#667eea' }}
      />

      <input
        type="text"
        style={{ height: 34, border: '1px solid #cbd5e1', padding: '0 8px' }}
      />

      <a
        href="/deals"
        style={{ display: 'inline-block', width: 36, height: 36, border: '1px solid #667eea' }}
      />

      <img
        src={sampleImage}
        style={{ width: 120, height: 72, objectFit: 'cover' }}
      />
    </Box>
  </Box>
);

export default ExperimentA11yRegressions;
