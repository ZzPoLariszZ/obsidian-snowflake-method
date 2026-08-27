import { describe, expect, it } from 'vitest';

import { countSentences } from '../../src/domain';

describe('counting sentences', () => {
	it('reads the plain terminators of both scripts', () => {
		expect(countSentences('天亮了。他起身。')).toBe(2);
		expect(countSentences('It rained. He left. She stayed.')).toBe(3);
		expect(countSentences('真的吗？真的！')).toBe(2);
	});

	it('reads a run of terminators as one boundary', () => {
		expect(countSentences('什么？！不会吧？？')).toBe(2);
		expect(countSentences('他愣住了……然后笑了。')).toBe(2);
		expect(countSentences('Wait...')).toBe(1);
	});

	it('lets a closing quote ride with its sentence', () => {
		expect(countSentences('他说：「走吧。」然后走了。')).toBe(2);
		expect(countSentences('"Go home." He waved.')).toBe(2);
	});

	it('keeps a full stop inside numbers and names whole', () => {
		expect(countSentences('Pi is 3.14 for short.')).toBe(1);
		expect(countSentences('He mailed file.txt today.')).toBe(1);
		expect(countSentences('The U.S.A. is far away.')).toBe(2);
	});

	it('splits at an abbreviation, the documented simplification', () => {
		expect(countSentences('Mr. Smith arrived.')).toBe(2);
	});

	it('counts a trailing thought without a terminator', () => {
		expect(countSentences('他没有说完')).toBe(1);
		expect(countSentences('第一段没说完\n\n第二段。')).toBe(2);
	});

	it('counts nothing where nothing is written', () => {
		expect(countSentences('')).toBe(0);
		expect(countSentences('   \n\n  ')).toBe(0);
		expect(countSentences('。。。')).toBe(0);
	});

	it('reads only the prose, code set aside', () => {
		expect(countSentences('One line. `a. b. c.`')).toBe(1);
	});
});
