/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import ReactOnRails from 'react-on-rails';
import AdminApp from '../components/AdminApp';

// Import stylesheets
import '../stylesheets/application.css';

// Register components with React on Rails
ReactOnRails.register({ AdminApp });
