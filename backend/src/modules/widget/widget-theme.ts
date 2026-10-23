export interface WidgetThemeValue {
  title: string;
  greeting: string;
  primaryColor: string;
  position: 'left' | 'right';
}

export const DEFAULT_WIDGET_THEME: WidgetThemeValue = {
  title: 'Support',
  greeting: 'Hi! How can we help?',
  primaryColor: '#0f172a',
  position: 'right',
};

export function withThemeDefaults(stored: Partial<WidgetThemeValue> | null | undefined): WidgetThemeValue {
  return { ...DEFAULT_WIDGET_THEME, ...(stored ?? {}) };
}
