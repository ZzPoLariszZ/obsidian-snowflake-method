import { de } from './de';
import { en, type TranslationKey } from './en';
import { es } from './es';
import { fr } from './fr';
import { ja } from './ja';
import { ko } from './ko';
import { zhCN } from './zh-CN';
import { zhTW } from './zh-TW';

export { de, en, es, fr, ja, ko, zhCN, zhTW };
export type { TranslationKey };

export const SUPPORTED_LOCALES = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type UiLocalePreference = 'project' | 'system' | SupportedLocale;
export type TranslationVariables = Readonly<Record<string, string | number>>;

type Translations = Readonly<Record<TranslationKey, string>>;

/**
 * English, which every language falls back to, and Simplified Chinese stand
 * ready as they always have. Each of the other six is made the first time it
 * is spoken and kept from then on: a session speaks one or two of them, and
 * a table made at every start is held for as long as the app is open,
 * whether or not a word of it is ever read.
 */
const TABLES: Readonly<Record<SupportedLocale, () => Translations>> = {
	en: () => en,
	'zh-CN': () => zhCN,
	'zh-TW': zhTW,
	ja,
	ko,
	fr,
	de,
	es,
};

const made = new Map<SupportedLocale, Translations>();

function tableOf(locale: SupportedLocale): Translations {
	let table = made.get(locale);
	if (table === undefined) {
		table = TABLES[locale]();
		made.set(locale, table);
	}
	return table;
}

/**
 * Each language in its own words, the way a language menu names it whatever
 * language the menu around it speaks.
 */
export const LOCALE_NAMES: Readonly<Record<SupportedLocale, string>> = {
	en: 'English',
	'zh-CN': '简体中文',
	'zh-TW': '繁體中文',
	ja: '日本語',
	ko: '한국어',
	fr: 'Français',
	de: 'Deutsch',
	es: 'Español',
};

/** The tag the platform's number and date formatting is asked for in each language. */
const INTL_LOCALES: Readonly<Record<SupportedLocale, string>> = {
	en: 'en-US',
	'zh-CN': 'zh-CN',
	'zh-TW': 'zh-TW',
	ja: 'ja-JP',
	ko: 'ko-KR',
	fr: 'fr-FR',
	de: 'de-DE',
	es: 'es-ES',
};

export function isSupportedLocale(value: unknown): value is SupportedLocale {
	return (SUPPORTED_LOCALES as readonly unknown[]).includes(value);
}

export function intlLocaleOf(locale: SupportedLocale): string {
	return INTL_LOCALES[locale];
}

/**
 * The interface language a platform locale asks for. Chinese written in the
 * traditional script, or for Taiwan, Hong Kong or Macau, reads Traditional
 * Chinese unless the tag names the simplified script; any other Chinese reads
 * Simplified. A language the plugin does not speak reads English.
 */
export function systemLocaleOf(systemLocale: string): SupportedLocale {
	const [language = '', ...subtags] = systemLocale
		.trim()
		.replaceAll('_', '-')
		.toLowerCase()
		.split('-');
	if (language === 'zh') {
		if (subtags.includes('hans')) return 'zh-CN';
		return subtags.some((tag) => tag === 'hant' || tag === 'tw' || tag === 'hk' || tag === 'mo')
			? 'zh-TW'
			: 'zh-CN';
	}
	if (language === 'ja' || language === 'ko' || language === 'fr' || language === 'de' || language === 'es') {
		return language;
	}
	return 'en';
}

export function resolveLocale(
	preference: UiLocalePreference,
	systemLocale: string,
	projectLocale: SupportedLocale = 'en',
): SupportedLocale {
	if (preference === 'project') return projectLocale;
	if (preference !== 'system') return preference;
	return systemLocaleOf(systemLocale);
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
	const localized = tableOf(locale)[key as TranslationKey];
	const fallback = en[key as TranslationKey];
	return interpolate(localized ?? fallback ?? key, variables);
}

export const translate = t;
