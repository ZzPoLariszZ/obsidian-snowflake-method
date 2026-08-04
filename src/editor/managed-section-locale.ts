import {
	resolveLocale,
	type SupportedLocale,
	type UiLocalePreference,
} from '../i18n';
import { parseMarkdownFrontmatter, projectIdOf } from '../repository';

export interface ManagedSectionLocaleContext {
	uiLocale: UiLocalePreference;
	obsidianLocale: string;
	fallbackProjectLocale: SupportedLocale;
	content: string;
	projectLocalesById: ReadonlyMap<string, SupportedLocale>;
}

/** Resolve editor copy from the note's own project rather than the active dashboard. */
export function resolveManagedSectionLocale(
	context: ManagedSectionLocaleContext,
): SupportedLocale {
	return resolveLocale(
		context.uiLocale,
		context.obsidianLocale,
		projectLocaleOf(context) ?? context.fallbackProjectLocale,
	);
}

/**
 * A note being edited holds frontmatter that does not parse yet whenever the
 * author is midway through a line. Editor copy then falls back to the active
 * project instead of throwing: this runs inside the CodeMirror decoration
 * builder and transaction filter, which would otherwise lose their managed
 * section guidance for the rest of the view's life.
 */
function projectLocaleOf(
	context: ManagedSectionLocaleContext,
): SupportedLocale | undefined {
	if (context.uiLocale !== 'project') return undefined;
	let projectId: string | null;
	try {
		projectId = projectIdOf(
			parseMarkdownFrontmatter(context.content).frontmatter,
		);
	} catch {
		return undefined;
	}
	return projectId === null
		? undefined
		: context.projectLocalesById.get(projectId);
}
