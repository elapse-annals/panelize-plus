// Shared only inside this extension's isolated content-script world.
(function() {
  'use strict';
  globalThis.PanelizeContent ||= { factories: Object.create(null), started: false };
})();
