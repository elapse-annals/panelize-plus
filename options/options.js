/** Composition root. Feature state and behavior live in controllers. */

import { createProvidersController } from './controllers/providers.js';
import { createApplicationController } from './controllers/application.js';
import { createDataController } from './controllers/data.js';
import { createInputSettingsController } from './controllers/input-settings.js';
import { createSummaryController } from './controllers/summary.js';
import { createVersionController } from './controllers/version.js';

const providers = createProvidersController();

const application = createApplicationController({
  getDataController: () => data,
  getInputSettingsController: () => inputSettings,
  getProvidersController: () => providers,
  getSummaryController: () => summary,
  getVersionController: () => version
});

const data = createDataController({
  getApplicationController: () => application,
  getProvidersController: () => providers
});

const inputSettings = createInputSettingsController({
  getApplicationController: () => application,
  getDataController: () => data,
  getProvidersController: () => providers,
  getSummaryController: () => summary,
  getVersionController: () => version
});

const summary = createSummaryController();

const version = createVersionController();

// Initialize on load
application.init();
