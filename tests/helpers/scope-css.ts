/**
 * A stylesheet written for the whole page, kept to one part of it: every
 * selector is set under a class of the plugin's own, and every animation it
 * names is given a name of the plugin's own, so neither can reach what
 * another plugin draws, nor be reached by it. What a rule says is left word
 * for word as it came.
 *
 * The plugin ships the engine's stylesheet inside its own, since a plugin's
 * one stylesheet is all the app loads for it. This is how that copy is made,
 * and what the styles test measures the copy against, so a library moved to
 * another version without its stylesheet is a test that fails.
 */

export interface CssScope {
	/** The selector every rule is set under. */
	under: string;
	/** What goes before the name of every animation the sheet defines. */
	keyframes: string;
}

/** The names of the animations a sheet defines. */
function keyframeNames(css: string): string[] {
	return [...css.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/gu)].map((match) => match[1]!);
}

/** A rule's selectors, each on a line of its own under the scope. */
function scopedPrelude(prelude: string, under: string): string {
	return prelude
		.split(',')
		.map((selector) => selector.trim().replace(/\s+/gu, ' '))
		.filter((selector) => selector.length > 0)
		.map((selector) => `${under} ${selector}`)
		.join(',\n');
}

export function scopeCss(css: string, scope: CssScope): string {
	let renamed = css;
	for (const name of keyframeNames(css)) {
		// The name where it stands as a word of its own, and not as part of a longer one.
		renamed = renamed.replace(
			new RegExp(`(^|[^\\w-])${name}(?![\\w-])`, 'gu'),
			(_whole, before: string) => `${before}${scope.keyframes}${name}`,
		);
	}
	let out = '';
	/** What stands between the last brace, or the sheet's head, and the place being read. */
	let pending = '';
	/**
	 * What each brace still open was opened by: the steps of an animation,
	 * whose own names are no selectors and are left as they are; a rule that
	 * gathers others under a condition, whose rules are scoped as any are; or
	 * a rule that holds declarations alone.
	 */
	const open: ('steps' | 'group' | 'rule')[] = [];
	for (let index = 0; index < renamed.length; index += 1) {
		const char = renamed[index]!;
		if (char === '/' && renamed[index + 1] === '*') {
			const end = renamed.indexOf('*/', index + 2);
			const stop = end === -1 ? renamed.length : end + 2;
			pending += renamed.slice(index, stop);
			index = stop - 1;
			continue;
		}
		if (char === '{') {
			// What comes before a rule's own words may be comments and blank
			// lines, which stay where they are: only the selectors are rewritten.
			const lead = /^(?:\s|\/\*[\s\S]*?\*\/)*/u.exec(pending)?.[0] ?? '';
			const prelude = pending.slice(lead.length).trim();
			if (open[open.length - 1] === 'steps') {
				out += `${pending}{`;
				open.push('rule');
			} else if (/^@(?:-[a-z]+-)?keyframes\b/u.test(prelude)) {
				out += `${lead}${prelude} {`;
				open.push('steps');
			} else if (/^@(?:media|supports|container|layer)\b/u.test(prelude)) {
				out += `${lead}${prelude} {`;
				open.push('group');
			} else if (prelude.startsWith('@')) {
				out += `${lead}${prelude} {`;
				open.push('rule');
			} else {
				out += `${lead}${scopedPrelude(prelude, scope.under)} {`;
				open.push('rule');
			}
			pending = '';
			continue;
		}
		if (char === '}') {
			out += `${pending}}`;
			pending = '';
			open.pop();
			continue;
		}
		pending += char;
	}
	return `${out}${pending}`;
}
