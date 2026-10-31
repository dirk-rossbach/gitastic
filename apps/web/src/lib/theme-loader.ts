import type { ThemeManifest } from '@gitastic/shared';
import { api } from '../api';
import { registerCustomThemes } from '../ui-styles';

const STYLE_ATTRIBUTE = 'data-gitastic-theme';

async function injectThemeCss(id: string): Promise<void> {
  const css = await api.themeCss(id);
  let element = document.querySelector<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}="${id}"]`);
  if (!element) {
    element = document.createElement('style');
    element.setAttribute(STYLE_ATTRIBUTE, id);
    document.head.appendChild(element);
  }
  element.textContent = css;
}

export async function loadCustomThemes(): Promise<ThemeManifest[]> {
  const { themes } = await api.themes();
  await Promise.all(
    themes.map(async (theme) => {
      try {
        await injectThemeCss(theme.id);
      } catch {
        // A theme whose CSS cannot be read stays out of the active library.
      }
    }),
  );
  registerCustomThemes(themes);
  return themes;
}

export function removeThemeCss(id: string): void {
  document.querySelector(`style[${STYLE_ATTRIBUTE}="${id}"]`)?.remove();
}
