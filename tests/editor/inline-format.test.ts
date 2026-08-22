import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import {
	toggleHeading,
	toggleInline,
	type HeadingLevel,
	type InlineMarker,
} from '../../src/editor/inline-format';

/**
 * Specs written the way a caret sees them: `|` is a cursor, `[` and `]` hold
 * the selection. The result renders back the same way, so every assertion
 * reads as before-and-after text.
 */
function parse(spec: string): { doc: string; anchor: number; head: number } {
	const open = spec.indexOf('[');
	if (open >= 0) {
		const close = spec.indexOf(']');
		return {
			doc: spec.slice(0, open) + spec.slice(open + 1, close) + spec.slice(close + 1),
			anchor: open,
			head: close - 1,
		};
	}
	const caret = spec.indexOf('|');
	return { doc: spec.replace('|', ''), anchor: caret, head: caret };
}

function render(doc: string, from: number, to: number): string {
	if (from === to) return doc.slice(0, from) + '|' + doc.slice(from);
	return doc.slice(0, from) + '[' + doc.slice(from, to) + ']' + doc.slice(to);
}

function inline(spec: string, marker: InlineMarker): string {
	const { doc, anchor, head } = parse(spec);
	const state = EditorState.create({
		doc,
		selection: EditorSelection.single(anchor, head),
	});
	const plan = toggleInline(state, marker);
	if (plan === null) return spec;
	const next = state.update(plan).state;
	const main = next.selection.main;
	return render(next.doc.toString(), main.from, main.to);
}

function heading(spec: string, level: HeadingLevel): string {
	const { doc, anchor, head } = parse(spec);
	const state = EditorState.create({
		doc,
		selection: EditorSelection.single(anchor, head),
	});
	const plan = toggleHeading(state, level);
	if (plan === null) return spec;
	const next = state.update(plan).state;
	const main = next.selection.main;
	return render(next.doc.toString(), main.from, main.to);
}

describe('toggleInline at a cursor', () => {
	it('walks the whole bold and italic ladder by star runs', () => {
		expect(inline('|', 'bold')).toBe('**|**');
		expect(inline('**|**', 'italic')).toBe('***|***');
		expect(inline('***|***', 'italic')).toBe('**|**');
		expect(inline('***|***', 'bold')).toBe('*|*');
		expect(inline('*|*', 'bold')).toBe('***|***');
		expect(inline('*|*', 'italic')).toBe('|');
		expect(inline('**|**', 'bold')).toBe('|');
	});

	it('opens and closes the literal pairs around the caret', () => {
		expect(inline('|', 'strikethrough')).toBe('~~|~~');
		expect(inline('~~|~~', 'strikethrough')).toBe('|');
		expect(inline('|', 'highlight')).toBe('==|==');
		expect(inline('==|==', 'highlight')).toBe('|');
		expect(inline('|', 'underline')).toBe('<u>|</u>');
		expect(inline('<u>|</u>', 'underline')).toBe('|');
	});

	it('leaves neighbouring prose out of the pair', () => {
		expect(inline('before |after', 'bold')).toBe('before **|**after');
		expect(inline('done~~ |', 'strikethrough')).toBe('done~~ ~~|~~');
	});

	it('writes the plain pair wherever the caret stands', () => {
		// Even on an empty line, where `~~~~` would be a tilde fence to
		// CommonMark: the writing count reads no tilde fences, by design.
		expect(inline('para\n\n|', 'strikethrough')).toBe('para\n\n~~|~~');
		expect(inline('para\n|', 'highlight')).toBe('para\n==|==');
	});
});

describe('toggleInline over a selection', () => {
	it('wraps and unwraps from around the selection', () => {
		expect(inline('[bold]', 'bold')).toBe('**[bold]**');
		expect(inline('**[bold]**', 'bold')).toBe('[bold]');
		expect(inline('[text]', 'highlight')).toBe('==[text]==');
		expect(inline('==[text]==', 'highlight')).toBe('[text]');
		expect(inline('[text]', 'underline')).toBe('<u>[text]</u>');
		expect(inline('<u>[text]</u>', 'underline')).toBe('[text]');
	});

	it('unwraps a selection that carries its own pair', () => {
		expect(inline('[**bold**]', 'bold')).toBe('[bold]');
		expect(inline('[~~gone~~]', 'strikethrough')).toBe('[gone]');
		expect(inline('[<u>under</u>]', 'underline')).toBe('[under]');
	});

	it('stacks italic inside bold and takes it back out', () => {
		expect(inline('**[bold]**', 'italic')).toBe('***[bold]***');
		expect(inline('***[bold]***', 'italic')).toBe('**[bold]**');
		expect(inline('***[bold]***', 'bold')).toBe('*[bold]*');
		expect(inline('[*italic*]', 'italic')).toBe('[italic]');
	});


	it('applies to every range of a multiple selection', () => {
		const state = EditorState.create({
			doc: 'one two',
			selection: EditorSelection.create([
				EditorSelection.range(0, 3),
				EditorSelection.range(4, 7),
			]),
			extensions: EditorState.allowMultipleSelections.of(true),
		});
		const plan = toggleInline(state, 'bold');
		expect(plan).not.toBeNull();
		if (plan === null) return;
		const next = state.update(plan).state;
		expect(next.doc.toString()).toBe('**one** **two**');
		expect(next.selection.ranges.map((range) => [range.from, range.to])).toEqual([
			[2, 5],
			[10, 13],
		]);
	});
});

describe('toggleHeading', () => {
	it('sets, switches and clears a level on the caret line', () => {
		expect(heading('text|', 2)).toBe('## text|');
		expect(heading('## text|', 3)).toBe('### text|');
		expect(heading('### tex|t', 3)).toBe('tex|t');
	});

	it('marks every line the selection touches and skips blank ones', () => {
		// The mapped selection hugs the prose, leaving the new prefix outside.
		expect(heading('[one\n\ntwo]', 2)).toBe('## [one\n\n## two]');
	});

	it('clears only when every touched line already sits at the level', () => {
		expect(heading('[## one\n### two]', 2)).toBe('[## one\n## two]');
		expect(heading('[## one\n## two]', 2)).toBe('[one\ntwo]');
	});

	it('starts a heading on an empty line for the author to type', () => {
		expect(heading('|', 2)).toBe('## |');
		expect(heading('para\n|', 3)).toBe('para\n### |');
		expect(heading('## |', 2)).toBe('|');
	});
});

describe('read-only states', () => {
	it('refuses to build a plan', () => {
		const state = EditorState.create({
			doc: 'text',
			extensions: EditorState.readOnly.of(true),
		});
		expect(toggleInline(state, 'bold')).toBeNull();
		expect(toggleHeading(state, 2)).toBeNull();
	});
});
