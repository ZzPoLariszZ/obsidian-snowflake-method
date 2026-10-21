/**
 * What a kind of note is called, stated once for every surface that names
 * one beside its symbol: the cards on the board and the canvas, and the
 * fields that offer a kind. A built-in kind has the copy's word, an
 * authored kind its own name.
 */

import {
	isWorldbuildingKind,
	type HistoryNoteRef,
	type WorldbuildingKindId,
} from '../domain';
import { isCharacterMember, type EntityMember } from './entity-card';
import type { Translate } from './modals';

/** The copy's word for a built-in kind, an authored kind's own name. */
export function kindWord(t: Translate, kind: string): string {
	if (kind === 'scene') return t('form.group.scene');
	if (kind === 'character') return t('form.group.character');
	return isWorldbuildingKind(kind) ? t(`worldbuilding.kind.${kind}`) : kind;
}

/** What a card's foot calls its note's kind: a time by its point or period, the rest by their kind. */
export function memberKindWord(t: Translate, member: EntityMember): string {
	if (isCharacterMember(member)) return kindWord(t, 'character');
	if (member.kind === 'time') return t(member.timeKind === 'period' ? 'form.timeKind.period' : 'form.timeKind.point');
	return kindWord(t, member.kind);
}

/** A key with a built-in kind's own entry, or the `custom` entry with the kind's name filled in. */
export function kindText(t: Translate, prefix: string, kind: WorldbuildingKindId): string {
	return isWorldbuildingKind(kind) ? t(`${prefix}.${kind}`) : t(`${prefix}.custom`, { name: kind });
}

/**
 * What the modification history calls a note's kind: the entities by the
 * copy's word or their own name, the manuscript and the steps by theirs,
 * and the rest as the other notes they are.
 */
export function historyKindLabel(t: Translate, ref: HistoryNoteRef): string {
	switch (ref.kind) {
		case 'character':
		case 'scene':
			return kindWord(t, ref.kind);
		case 'worldbuilding':
			return kindWord(t, ref.wbKind ?? '');
		case 'manuscript':
			return t('manuscript.title');
		case 'step':
			return ref.step === undefined ? t('dashboard.steps') : t(`steps.${String(ref.step)}.title`);
		default:
			return t('history.kind.other');
	}
}
