// @vitest-environment happy-dom

import type { Setting } from 'obsidian';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const notices = vi.hoisted(() => [] as string[]);

// The real rows, with a notice that keeps what it was given to say.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Notice: class {
			constructor(text: string) {
				notices.push(text);
			}
		},
	};
});

import type { ServerStatus } from '../../api/index';
import { DEFAULT_LOCAL_API_PREFERENCES, type LocalApiAccess } from '../../src/domain';
import { t as translate } from '../../src/i18n';
import type { LocalApiSettingsBridge } from '../../src/ui/local-api-bridge';
import {
	localApiStatusText,
	renderLocalApiNotes,
	renderLocalApiStatus,
	renderLocalApiToken,
} from '../../src/ui/local-api-settings';
import { installObsidianDom } from '../helpers/obsidian-dom';

const t = (key: string, vars?: Record<string, string | number>): string => translate('en', key, vars);

/** A settings row with real elements: a name and a description on one side, its controls on the other. */
class Row {
	readonly settingEl = document.body.createDiv({ cls: 'setting-item' });
	readonly infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
	readonly descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
	readonly controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
	readonly buttons: HTMLButtonElement[] = [];

	addButton(build: (button: unknown) => unknown): this {
		const el = this.controlEl.createEl('button');
		this.buttons.push(el);
		const button = {
			setButtonText: (text: string) => {
				el.textContent = text;
				return button;
			},
			setDisabled: (disabled: boolean) => {
				el.disabled = disabled;
				return button;
			},
			onClick: (handler: () => void) => {
				el.addEventListener('click', handler);
				return button;
			},
		};
		build(button);
		return this;
	}

	get setting(): Setting {
		return this as unknown as Setting;
	}

	/** The lines under the row's name. */
	said(): string[] {
		return [...this.descEl.children].map((line) => line.textContent);
	}

	button(words: string): HTMLButtonElement {
		const found = this.buttons.find((button) => button.textContent === words);
		if (found === undefined) throw new Error(`No button says ${words}.`);
		return found;
	}
}

function rig(
	start: {
		token?: string | null;
		status?: ServerStatus;
		renewal?: 'renewed' | 'declined' | 'failed';
		access?: LocalApiAccess;
	} = {},
) {
	const held: { token: string | null; status: ServerStatus; renewal: 'renewed' | 'declined' | 'failed' } = {
		token: start.token === undefined ? 'snowflake_secret' : start.token,
		status: start.status ?? { state: 'off' },
		renewal: start.renewal ?? 'renewed',
	};
	const calls: string[] = [];
	const refreshed = { count: 0 };
	const bridge: LocalApiSettingsBridge = {
		preferences: () => ({ ...DEFAULT_LOCAL_API_PREFERENCES, access: start.access ?? DEFAULT_LOCAL_API_PREFERENCES.access }),
		update: () => Promise.resolve(),
		status: () => held.status,
		token: () => held.token,
		renewToken: () => {
			calls.push('renew');
			if (held.renewal === 'renewed') held.token = 'snowflake_newer';
			return Promise.resolve(held.renewal);
		},
		retry: () => {
			calls.push('retry');
			held.status = { state: 'listening', port: 27125 };
			return Promise.resolve();
		},
	};
	const refresh = (): void => {
		refreshed.count += 1;
	};
	return { held, calls, refreshed, bridge, refresh };
}

const copied: string[] = [];
const settle = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

beforeAll(() => {
	installObsidianDom(window);
	Object.defineProperty(window.navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText: (text: string): Promise<void> => {
				copied.push(text);
				return Promise.resolve();
			},
		},
	});
});

afterEach(() => {
	document.body.empty();
	notices.length = 0;
	copied.length = 0;
});

describe('the access token’s row', () => {
	it('says what the token is for and never shows it', () => {
		const { bridge, refresh } = rig();
		const row = new Row();
		renderLocalApiToken(row.setting, bridge, t, refresh);
		expect(row.said()).toEqual(['A caller sends it with every call.']);
		expect(row.settingEl.textContent).not.toContain('snowflake_secret');
		expect(row.settingEl.innerHTML).not.toContain('snowflake_secret');
		expect(row.buttons.map((button) => [button.textContent, button.disabled])).toEqual([
			['Copy', false],
			['Make new token', false],
		]);
	});

	it('says there is none yet, and offers nothing to copy', () => {
		const { bridge, refresh } = rig({ token: null });
		const row = new Row();
		renderLocalApiToken(row.setting, bridge, t, refresh);
		expect(row.said()[1]).toBe('No token yet. One is made when the local API is first switched on.');
		expect(row.button('Copy').disabled).toBe(true);
		expect(row.button('Make new token').disabled).toBe(false);
	});

	it('puts the token on the clipboard and says so', async () => {
		const { bridge, refresh } = rig();
		const row = new Row();
		renderLocalApiToken(row.setting, bridge, t, refresh);
		row.button('Copy').click();
		await settle();
		expect(copied).toEqual(['snowflake_secret']);
		expect(notices).toEqual(['Access token copied.']);
	});

	it('copies the token that stands now, not the one the row was drawn with', async () => {
		const { bridge, refresh, held } = rig();
		const row = new Row();
		renderLocalApiToken(row.setting, bridge, t, refresh);
		held.token = 'snowflake_newer';
		row.button('Copy').click();
		await settle();
		expect(copied).toEqual(['snowflake_newer']);
	});

	it('makes a new one when the author agrees, says the old one is done with, and draws the page again', async () => {
		const { bridge, refresh, refreshed, calls } = rig();
		const row = new Row();
		renderLocalApiToken(row.setting, bridge, t, refresh);
		row.button('Make new token').click();
		await settle();
		expect(calls).toEqual(['renew']);
		expect(notices).toEqual(['New access token made. The old one no longer works.']);
		expect(refreshed.count).toBe(1);
	});

	it('says nothing and changes nothing when the author declines', async () => {
		const { bridge, refresh, refreshed } = rig({ renewal: 'declined' });
		const row = new Row();
		renderLocalApiToken(row.setting, bridge, t, refresh);
		row.button('Make new token').click();
		await settle();
		expect(notices).toEqual([]);
		expect(refreshed.count).toBe(0);
	});

	it('says so when Obsidian’s keychain would not keep the new one', async () => {
		const { bridge, refresh } = rig({ renewal: 'failed' });
		const row = new Row();
		renderLocalApiToken(row.setting, bridge, t, refresh);
		row.button('Make new token').click();
		await settle();
		expect(notices).toEqual(['Obsidian’s keychain could not keep a new token.']);
	});
});

describe('the notes at the head of the section', () => {
	it('stand as the recording’s do: a heading, what the API is for, a warning, and where the choices are kept', () => {
		const row = new Row();
		renderLocalApiNotes(row.setting, t);
		expect([...row.settingEl.classList]).toEqual([
			'setting-item',
			'snowflake-method-settings-recording-bare',
			'snowflake-method-settings-local-api-notes',
		]);
		expect(row.settingEl.querySelector('.setting-item-name')?.textContent).toBe('About');
		const notices = [...row.settingEl.querySelectorAll<HTMLElement>('.snowflake-method-history-notice')];
		expect(notices.map((notice) => notice.dataset.tone)).toEqual(['accent', 'warning']);
		expect(
			notices.map((notice) => notice.querySelector('.snowflake-method-history-notice-text')?.textContent),
		).toEqual([
			'Lets other programs on this computer read and write your Snowflake projects.',
			'Give the access token only to programs you trust.',
		]);
		expect(row.settingEl.querySelector('.snowflake-method-hint')?.textContent).toBe(
			'These settings are kept on this device only.',
		);
	});

	it('warns in every language whom the token goes to, names no kind of caller, and never says that nothing leaves', () => {
		for (const locale of ['en', 'de', 'es', 'fr', 'ja', 'ko', 'zh-CN', 'zh-TW'] as const) {
			const caution = translate(locale, 'localApi.note.caution');
			expect(caution.split('\n'), locale).toHaveLength(1);
			expect(caution, locale).not.toMatch(/internet|互联网|網際網路|インターネット|인터넷/iu);
			expect(translate(locale, 'localApi.note.purpose'), locale).not.toMatch(/AI|KI|IA|에이전트|エージェント|助手|助理/u);
		}
	});

	it('names the switch after the section in every language, so it reads as the API’s own switch', () => {
		for (const locale of ['en', 'de', 'es', 'fr', 'ja', 'ko', 'zh-CN', 'zh-TW'] as const) {
			const section = translate(locale, 'settings.section.localApi');
			expect(translate(locale, 'localApi.http.name').toLowerCase(), locale).toContain(section.toLowerCase());
		}
	});

	it('speaks of the API and never of a listener, in the words an author reads', () => {
		const keys = [
			'localApi.http.name',
			'localApi.port.desc',
			'localApi.token.none',
			'localApi.status.off',
			'localApi.status.listening',
			'localApi.status.failed',
			'localApi.status.no-listener',
			'localApi.status.no-token',
		];
		for (const locale of ['en', 'de', 'es', 'fr', 'ja', 'ko', 'zh-CN', 'zh-TW'] as const) {
			for (const key of keys) {
				expect(translate(locale, key), `${locale} ${key}`).not.toMatch(/listen|HTTP|escucha|écoute|リスナー|리스너|监听|監聽/iu);
			}
		}
	});
});

describe('the listener’s status row', () => {
	it('says where the listener stands, in each of its standings', () => {
		const cases: [ServerStatus, string][] = [
			[{ state: 'off' }, 'The local API is off.'],
			[{ state: 'listening', port: 27125 }, 'Running on 127.0.0.1:27125.'],
			[{ state: 'failed', port: 27125, reason: 'in-use' }, 'Port 27125 is in use by another program. Choose another port.'],
			[{ state: 'failed', port: 80, reason: 'denied' }, 'The system refused port 80. Choose another port.'],
			[{ state: 'failed', port: 0, reason: 'failed' }, 'The local API could not be started.'],
			[{ state: 'failed', port: 27125, reason: 'no-listener' }, 'This device cannot run the local API.'],
			[{ state: 'failed', port: 27125, reason: 'no-token' }, 'There is no access token, so the local API is off.'],
		];
		for (const [status, words] of cases) expect(localApiStatusText(t, status), words).toBe(words);
	});

	it('offers nothing to press while the listener is off or answering', () => {
		for (const status of [{ state: 'off' }, { state: 'listening', port: 27125 }] as ServerStatus[]) {
			const { bridge, refresh } = rig({ status });
			const row = new Row();
			renderLocalApiStatus(row.setting, bridge, t, refresh);
			expect(row.said()).toEqual(['Access: Read only', localApiStatusText(t, status)]);
			expect(row.buttons).toEqual([]);
		}
	});

	it('wears the colour of its standing: success while it answers, error where it could not start, none while off', () => {
		const cases: [ServerStatus, string[]][] = [
			[{ state: 'off' }, []],
			[{ state: 'listening', port: 27125 }, ['snowflake-method-settings-local-api-listening']],
			[{ state: 'failed', port: 27125, reason: 'in-use' }, ['snowflake-method-settings-local-api-failed']],
		];
		for (const [status, classes] of cases) {
			const { bridge, refresh } = rig({ status });
			const row = new Row();
			renderLocalApiStatus(row.setting, bridge, t, refresh);
			const [access, standing] = [...row.descEl.children];
			expect([...(standing?.classList ?? [])], status.state).toEqual(classes);
			// How far a caller may go is said plainly, whatever the standing.
			expect([...(access?.classList ?? [])], status.state).toEqual([]);
		}
	});

	it('says how far a caller may go, at each level', () => {
		const levels: [LocalApiAccess, string][] = [
			['read', 'Access: Read only'],
			['write', 'Access: Read and write'],
			['delete', 'Access: Read, write and delete'],
		];
		for (const [access, words] of levels) {
			const { bridge, refresh } = rig({ status: { state: 'listening', port: 27125 }, access });
			const row = new Row();
			renderLocalApiStatus(row.setting, bridge, t, refresh);
			expect(row.said()).toEqual([words, 'Running on 127.0.0.1:27125.']);
		}
	});

	it('offers another try where it could not be started, and draws the page again after it', async () => {
		const { bridge, refresh, refreshed, calls } = rig({ status: { state: 'failed', port: 27125, reason: 'in-use' } });
		const row = new Row();
		renderLocalApiStatus(row.setting, bridge, t, refresh);
		expect(row.said()).toEqual(['Access: Read only', 'Port 27125 is in use by another program. Choose another port.']);
		row.button('Retry').click();
		await settle();
		expect(calls).toEqual(['retry']);
		expect(refreshed.count).toBe(1);
	});
});
