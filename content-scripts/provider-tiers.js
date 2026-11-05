// Entry point for model/reasoning tier requests.
(function(runtime) {
  'use strict';
  if (runtime.tiersStarted) return;
  runtime.tiersStarted = true;
  const {
    createTierConfigController,
    createTierDomController,
    createTierDiscoveryController,
    createTierSliderController,
    createTierMenuController,
    createTierRequestsController,
    createTierRecipesController
  } = runtime.factories;

  const tierConfig = createTierConfigController();

  const tierDom = createTierDomController({
    getTierConfigController: () => tierConfig
  });

  const tierDiscovery = createTierDiscoveryController({
    getTierConfigController: () => tierConfig,
    getTierDomController: () => tierDom,
    getTierMenuController: () => tierMenu
  });

  const tierSlider = createTierSliderController({
    getTierConfigController: () => tierConfig,
    getTierDiscoveryController: () => tierDiscovery,
    getTierDomController: () => tierDom,
    getTierMenuController: () => tierMenu
  });

  const tierMenu = createTierMenuController({
    getTierConfigController: () => tierConfig,
    getTierDiscoveryController: () => tierDiscovery,
    getTierDomController: () => tierDom,
    getTierRecipesController: () => tierRecipes
  });

  const tierRequests = createTierRequestsController({
    getTierConfigController: () => tierConfig,
    getTierDiscoveryController: () => tierDiscovery,
    getTierMenuController: () => tierMenu,
    getTierRecipesController: () => tierRecipes,
    getTierSliderController: () => tierSlider
  });

  const tierRecipes = createTierRecipesController({
    getTierConfigController: () => tierConfig,
    getTierDiscoveryController: () => tierDiscovery,
    getTierDomController: () => tierDom,
    getTierMenuController: () => tierMenu,
    getTierSliderController: () => tierSlider
  });

  document.addEventListener('click', tierMenu.invalidateModelFallback, true);

  document.addEventListener('change', tierMenu.invalidateModelFallback, true);

  window.addEventListener('message', tierRequests.onMessage);

})(globalThis.PanelizeContent);
