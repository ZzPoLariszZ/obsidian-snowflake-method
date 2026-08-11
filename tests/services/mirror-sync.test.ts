import { describe, expect, it } from 'vitest';

import { planFieldsBlockReconcile } from '../../src/services';
import { renderMarkedSection } from '../../src/templates';

describe('planFieldsBlockReconcile', () => {
	const expected = '> [!info] Scene overview\n> **Time**: Dawn';

	it('writes nothing when the block already says what the properties say', () => {
		const content = `# Arrival\n\n${renderMarkedSection('scene-fields', expected)}`;
		expect(
			planFieldsBlockReconcile({
				documentType: 'scene',
				content,
				expectedBlock: expected,
			}),
		).toBeNull();
	});

	it('rewrites a block that drifted from the properties', () => {
		const content = `# Arrival\n\n${renderMarkedSection('scene-fields', '> tampered')}`;
		expect(
			planFieldsBlockReconcile({
				documentType: 'scene',
				content,
				expectedBlock: expected,
			}),
		).toEqual({ sectionId: 'scene-fields', value: expected });
	});

	it('never writes into a note that has no block yet', () => {
		expect(
			planFieldsBlockReconcile({
				documentType: 'character',
				content: '# Ada\n\nProse only.',
				expectedBlock: expected,
			}),
		).toBeNull();
	});

	it('treats a CRLF block as equal to its LF expectation', () => {
		const content = renderMarkedSection('scene-fields', expected).replaceAll(
			'\n',
			'\r\n',
		);
		expect(
			planFieldsBlockReconcile({
				documentType: 'scene',
				content,
				expectedBlock: expected,
			}),
		).toBeNull();
	});

	it('reads a damaged block as absent and leaves it to the health check', () => {
		const content = '<!-- snowflake:section:character-fields:start -->\nHalf a block';
		expect(
			planFieldsBlockReconcile({
				documentType: 'character',
				content,
				expectedBlock: expected,
			}),
		).toBeNull();
	});
});
