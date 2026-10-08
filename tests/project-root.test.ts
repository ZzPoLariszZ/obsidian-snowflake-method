import { describe, expect, it } from 'vitest';

import { projectRootContaining } from '../src/project-root';

describe('projectRootContaining', () => {
	const roots = ['Snowflake Projects/Novel', 'Snowflake Archive/Old'];

	it('names the project folder holding a path, archived ones included', () => {
		expect(projectRootContaining('Snowflake Projects/Novel/50_Manuscript/Draft.md', roots)).toBe('Snowflake Projects/Novel');
		expect(projectRootContaining('Snowflake Projects/Novel', roots)).toBe('Snowflake Projects/Novel');
		expect(projectRootContaining('Snowflake Archive/Old/10_Summary', roots)).toBe('Snowflake Archive/Old');
	});

	it('answers null outside every project, and never the Vault root', () => {
		expect(projectRootContaining('Snowflake Projects/Novel Ideas/a.md', roots)).toBeNull();
		expect(projectRootContaining('Inbox/a.md', roots)).toBeNull();
		expect(projectRootContaining('Inbox/a.md', ['', ...roots])).toBeNull();
		expect(projectRootContaining('anything', [])).toBeNull();
	});
});
