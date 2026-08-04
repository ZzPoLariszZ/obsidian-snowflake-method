import { en, type TranslationKey } from './en';
import { zhCN } from './zh-CN';

export { en, zhCN };
export type { TranslationKey };

export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type UiLocalePreference = 'project' | 'system' | SupportedLocale;
export type TranslationVariables = Readonly<Record<string, string | number>>;

const TRANSLATIONS: Readonly<
	Record<SupportedLocale, Readonly<Record<TranslationKey, string>>>
> = {
	en,
	'zh-CN': zhCN,
};

export function isSupportedLocale(value: unknown): value is SupportedLocale {
	return value === 'en' || value === 'zh-CN';
}

export function resolveLocale(
	preference: UiLocalePreference,
	systemLocale: string,
	projectLocale: SupportedLocale = 'en',
): SupportedLocale {
	if (preference === 'project') return projectLocale;
	if (preference !== 'system') return preference;
	const normalized = systemLocale.trim().replaceAll('_', '-').toLowerCase();
	return normalized === 'zh' || normalized.startsWith('zh-') ? 'zh-CN' : 'en';
}

/** Global UI has no project context, so Follow Project falls back to Obsidian. */
export function resolveGlobalLocale(
	preference: UiLocalePreference,
	systemLocale: string,
): SupportedLocale {
	return resolveLocale(
		preference === 'project' ? 'system' : preference,
		systemLocale,
	);
}

function interpolate(
	template: string,
	variables?: TranslationVariables,
): string {
	if (variables === undefined) return template;
	return template.replace(/\{([^{}]+)\}/gu, (placeholder, name: string) =>
		Object.prototype.hasOwnProperty.call(variables, name)
			? String(variables[name])
			: placeholder,
	);
}

/** Unknown keys deliberately fall back to the key so UI work can be incremental. */
export function t(
	locale: SupportedLocale,
	key: string,
	variables?: TranslationVariables,
): string {
	const localized = TRANSLATIONS[locale][key as TranslationKey];
	const fallback = en[key as TranslationKey];
	return interpolate(localized ?? fallback ?? key, variables);
}

export const translate = t;
