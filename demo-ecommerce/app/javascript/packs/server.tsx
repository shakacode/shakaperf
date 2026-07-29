/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import ReactOnRails from 'react-on-rails';
import App from '../components/App';

// Register components with React on Rails for SSR
ReactOnRails.register({ App });
