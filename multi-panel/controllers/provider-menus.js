/**
 * Owns provider menus behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getEnabledProviders } from '../../modules/providers/providers.js';
import { MAX_PANELS } from '../../modules/panels/layout-auto-adjust.js';
import { getDropdownThemePalette, getThemeAwareProviderIcon, showToast } from './ui.js';

export function createProviderMenusController({
  getPanelsController
}) {
  // ===== Provider Switcher =====
  async function showProviderSwitcher(panelId) {
    const enabledProviders = await getEnabledProviders();
    const panel = getPanelsController().panels.find(p => p.id === panelId);
    if (!panel) return;
    const palette = getDropdownThemePalette();

    // Create a simple dropdown menu
    const menu = document.createElement('div');
    menu.className = 'provider-switcher-menu';
    menu.style.cssText = `
    position: fixed;
    background: ${palette.menuBackground};
    border: 1px solid ${palette.menuBorder};
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 1000;
    min-width: 160px;
    padding: 8px 0;
  `;

    menu.innerHTML = enabledProviders.map(provider => `
    <div class="provider-switcher-item" data-provider-id="${provider.id}" style="
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      cursor: pointer;
      font-size: 14px;
      color: ${provider.id === panel.providerId ? palette.selectedText : palette.menuText};
      ${provider.id === panel.providerId ? `background: ${palette.selectedBackground};` : ''}
    ">
      <img src="${getThemeAwareProviderIcon(provider)}" alt="${provider.name}" style="width: 20px; height: 20px;" data-provider-id="${provider.id}">
      <span>${provider.name}</span>
    </div>
  `).join('');

    // Position menu near the panel
    const panelEl = document.getElementById(panelId);
    const rect = panelEl.querySelector('.switch-provider-btn').getBoundingClientRect();
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.left = rect.left + 'px';

    document.body.appendChild(menu);

    // Handle item clicks
    menu.querySelectorAll('.provider-switcher-item').forEach(item => {
      item.addEventListener('click', () => {
        getPanelsController().switchPanelProvider(panelId, item.dataset.providerId);
        menu.remove();
      });

      item.addEventListener('mouseenter', () => {
        if (item.dataset.providerId === panel.providerId) {
          item.style.background = palette.selectedBackground;
          item.style.color = palette.selectedText;
          return;
        }

        item.style.background = palette.itemHoverBackground;
        item.style.color = palette.menuText;
      });
      item.addEventListener('mouseleave', () => {
        if (item.dataset.providerId === panel.providerId) {
          item.style.background = palette.selectedBackground;
          item.style.color = palette.selectedText;
        } else {
          item.style.background = '';
          item.style.color = palette.menuText;
        }
      });
    });

    // Close on outside click
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  async function showAddPanelMenu() {
    if (getPanelsController().panels.length >= MAX_PANELS) {
      showToast(`Maximum number of panels reached (${MAX_PANELS})`);
      return;
    }

    const enabledProviders = await getEnabledProviders();
    const usedProviders = getPanelsController().panels.map(p => p.providerId);
    const availableProviders = enabledProviders.filter(p => !usedProviders.includes(p.id));

    if (availableProviders.length === 0) {
      showToast('All providers are already in use');
      return;
    }

    const btn = document.getElementById('add-panel-btn');
    const rect = btn.getBoundingClientRect();
    const palette = getDropdownThemePalette();

    const menu = document.createElement('div');
    menu.className = 'add-panel-menu';
    menu.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 4}px;
    left: ${rect.left}px;
    background: ${palette.menuBackground};
    border: 1px solid ${palette.menuBorder};
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 1000;
    min-width: 160px;
    padding: 8px 0;
  `;

    menu.innerHTML = availableProviders.map(provider => `
    <div class="add-panel-item" data-provider-id="${provider.id}" style="
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      cursor: pointer;
      font-size: 14px;
      color: ${palette.menuText};
    ">
      <img src="${getThemeAwareProviderIcon(provider)}" alt="${provider.name}" style="width: 20px; height: 20px;" data-provider-id="${provider.id}">
      <span>${provider.name}</span>
    </div>
  `).join('');

    document.body.appendChild(menu);

    menu.querySelectorAll('.add-panel-item').forEach(item => {
      item.addEventListener('click', () => {
        getPanelsController().addPanel(item.dataset.providerId);
        menu.remove();
      });

      item.addEventListener('mouseenter', () => {
        item.style.background = palette.itemHoverBackground;
        item.style.color = palette.menuText;
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = '';
        item.style.color = palette.menuText;
      });
    });

    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  return {
    showAddPanelMenu,
    showProviderSwitcher,
  };
}
