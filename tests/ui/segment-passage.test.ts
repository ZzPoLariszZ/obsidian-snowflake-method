import { describe, expect, it } from 'vitest';

import { findPassage, projectProse } from '../../src/ui/prose-projection';

const chapter = [
	'# Chapter Eleven',
	'',
	'The rain had not stopped since Tuesday and the road out was gone.',
	'',
	'She counted the coins twice. The rain had not stopped since Tuesday',
	'and by then it hardly mattered which way the road went.',
].join('\n');

describe('projectProse', () => {
	it('keeps the prose and remembers where each character came from', () => {
		const projection = projectProse('# Title\n\nBody text.');
		expect(projection.text).toBe('TitleBodytext.');
		// The T of Title sits after `# `.
		expect(projection.sourceIndexOf[0]).toBe(2);
		// The B of Body sits after the heading and the blank line.
		expect(projection.sourceIndexOf[5]).toBe(9);
	});

	it('projects a wikilink as the text the page shows for it', () => {
		const source = '去[[Demo/Alice|小艾]]家。';
		const projection = projectProse(source);
		expect(projection.text).toBe('去小艾家。');
		// The alias characters stand at their own source offsets.
		expect(projection.sourceIndexOf[1]).toBe(source.indexOf('|') + 1);
		expect(projection.sourceIndexOf[3]).toBe(source.indexOf('家'));
	});
});

describe('findPassage', () => {
	it('finds the words the reader was pointing at', () => {
		const passage = 'and the road out was gone';
		const lead = passage.indexOf('road');
		expect(findPassage(chapter, passage, lead, 0.2)).toBe(
			chapter.indexOf('road out'),
		);
	});

	it('finds words the markup broke apart', () => {
		// What the reader saw was `rain had not stopped`; what the file holds is
		// `rain had *not* stopped`. The projection holds what the reader saw.
		const source = 'The rain had *not* stopped since Tuesday, she wrote.';
		const passage = 'rain had not stopped since';
		expect(findPassage(source, passage, passage.indexOf('stopped'), 0)).toBe(
			source.indexOf('stopped'),
		);
		expect(findPassage(source, passage, passage.indexOf('not'), 0)).toBe(
			source.indexOf('not'),
		);
	});

	it('reads through headings, links, quotes and lists', () => {
		const source = [
			'# The **Longest** Night',
			'',
			'She opened the [old door](notes/door.md) and the cold came in.',
			'',
			'> He said the bridge would hold until morning.',
			'',
			'- first the rope',
			'- then the plank went down',
		].join('\n');
		const heading = 'The Longest Night';
		expect(findPassage(source, heading, heading.indexOf('Longest'), 0)).toBe(
			source.indexOf('Longest'),
		);
		const linked = 'opened the old door and the cold';
		expect(findPassage(source, linked, linked.indexOf('cold'), 0.3)).toBe(
			source.indexOf('cold'),
		);
		const quoted = 'said the bridge would hold';
		expect(findPassage(source, quoted, quoted.indexOf('hold'), 0.6)).toBe(
			source.indexOf('hold'),
		);
		// Rendered list items join with nothing between them, and match anyway.
		const listed = 'first the ropethen the plank went';
		expect(findPassage(source, listed, listed.indexOf('plank'), 0.9)).toBe(
			source.indexOf('plank'),
		);
	});

	it('crosses soft breaks and paragraph joins the page rendered away', () => {
		const source =
			'The road bent north\nand vanished under water.\n\nNobody followed them out.';
		// A soft break renders as <br>, whose textContent is nothing: the page
		// reads `northand`. A paragraph boundary reads `water.Nobody` the same way.
		const wrapped = 'road bent northand vanished under';
		expect(findPassage(source, wrapped, wrapped.indexOf('vanished'), 0)).toBe(
			source.indexOf('vanished'),
		);
		const joined = 'under water.Nobody followed them';
		expect(findPassage(source, joined, joined.indexOf('Nobody'), 0.8)).toBe(
			source.indexOf('Nobody'),
		);
	});

	it('sees escapes and entities as the characters the page shows', () => {
		const source =
			'A sign read \\*no entry\\* and cost &amp; effort kept it there.';
		const passage = 'read *no entry* and cost & effort kept';
		expect(findPassage(source, passage, passage.indexOf('cost'), 0)).toBe(
			source.indexOf('cost'),
		);
		// The caret on the escaped star lands on the star, not its backslash.
		expect(findPassage(source, passage, passage.indexOf('*no'), 0)).toBe(
			source.indexOf('*no'),
		);
	});

	it('reads past an image as the page does: as nothing', () => {
		const source =
			'Before the storm ![the sky](sky.png) turned green over the fields.';
		const passage = 'Before the storm turned green over';
		expect(findPassage(source, passage, passage.indexOf('green'), 0)).toBe(
			source.indexOf('green'),
		);
	});

	it('lands exactly in prose with no spaces to lean on', () => {
		const source =
			'她数了两遍铜钱。雨从周二起就没有停过，那条出村的路已经被**淹没**了。';
		const passage = '雨从周二起就没有停过，那条出村的路已经被淹没了。';
		expect(findPassage(source, passage, passage.indexOf('那条'), 0.5)).toBe(
			source.indexOf('那条'),
		);
		expect(findPassage(source, passage, passage.indexOf('淹没'), 0.5)).toBe(
			source.indexOf('淹没'),
		);
	});

	it('takes the copy nearest to where the reader was', () => {
		const refrain = 'The rain had not stopped since Tuesday';
		const filler = 'Something else about the road and the water went here. ';
		const source = `${refrain}. ${filler.repeat(30)}${refrain}.`;
		expect(findPassage(source, refrain, 0, 0.02)).toBe(source.indexOf(refrain));
		expect(findPassage(source, refrain, 0, 0.98)).toBe(
			source.lastIndexOf(refrain),
		);
	});

	it('reads a piped wikilink as its alias alone', () => {
		// What the reader saw was `恐怕非薰儿小姐莫属`; what the file holds is the
		// link with its target hidden. A click anywhere in the paragraph, the
		// alias itself included, must land on its own words.
		const source =
			'这个称呼，恐怕非[[演示/20_角色/萧薰儿|薰儿]]小姐莫属，旁人是当不起的。';
		const passage = '这个称呼，恐怕非薰儿小姐莫属，旁人是当不起的。';
		expect(findPassage(source, passage, passage.indexOf('恐怕'), 0.5)).toBe(
			source.indexOf('恐怕'),
		);
		expect(findPassage(source, passage, passage.indexOf('小姐'), 0.5)).toBe(
			source.indexOf('小姐'),
		);
		expect(findPassage(source, passage, passage.indexOf('薰儿小'), 0.5)).toBe(
			source.indexOf('|') + 1,
		);
	});

	it('reads a bare wikilink as its written target', () => {
		const source = '门口站着的正是[[萧薰儿]]本人，谁也没有想到。';
		const passage = '门口站着的正是萧薰儿本人，谁也没有想到。';
		expect(findPassage(source, passage, passage.indexOf('萧薰儿'), 0)).toBe(
			source.indexOf('萧薰儿'),
		);
		expect(findPassage(source, passage, passage.indexOf('本人'), 0)).toBe(
			source.indexOf('本人'),
		);
	});

	it('reads past an embed as the page does: as nothing', () => {
		const source = '山谷的清晨![[晨雾照片.png]]总是先冷后暖，等雾散了才见人。';
		const passage = '山谷的清晨总是先冷后暖，等雾散了才见人。';
		expect(findPassage(source, passage, passage.indexOf('总是'), 0)).toBe(
			source.indexOf('总是'),
		);
	});

	it('leaves a wikilink inside code standing verbatim', () => {
		const source = '语法写作 `[[目标|别名]]` 的样子，方括号照原样显示。';
		const passage = '语法写作 [[目标|别名]] 的样子，方括号照原样显示。';
		expect(findPassage(source, passage, passage.indexOf('别名'), 0)).toBe(
			source.indexOf('别名'),
		);
		expect(findPassage(source, passage, passage.indexOf('方括号'), 0)).toBe(
			source.indexOf('方括号'),
		);
	});

	it('defers to a comment that already hides the link whole', () => {
		const source =
			'前半句还在页面上<!-- [[隐藏目标|链接]] -->后半句也还在页面上。';
		const passage = '前半句还在页面上后半句也还在页面上。';
		expect(findPassage(source, passage, passage.indexOf('后半句'), 0)).toBe(
			source.indexOf('后半句'),
		);
	});

	it('gives up rather than guess at a passage too short to place', () => {
		// Eleven characters would be found in almost any chapter, and acting on
		// the wrong copy moves the page somewhere the author never was.
		expect(findPassage(chapter, 'the road', 0, 0)).toBeNull();
		expect(findPassage(chapter, '   \n  ', 0, 0)).toBeNull();
	});
});
