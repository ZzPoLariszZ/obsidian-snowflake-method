/**
 * The words a search is made of, and whether a text answers to them: each
 * word asked for found on its own, in any order and any case. Shared by the
 * freeform canvas, the timeline and the beat sheet, so the same words find
 * the same things on every surface. Pure, so the tests read it on no
 * document at all.
 */

/** The words asked for, each to be found on its own, in any order and any case. */
export function searchNeedles(query: string): string[] {
	return query.toLowerCase().split(/\s+/u).filter((word) => word.length > 0);
}

/** Whether a text answers to every word asked for. */
export function answersSearch(text: string, needles: readonly string[]): boolean {
	const lowered = text.toLowerCase();
	return needles.every((needle) => lowered.includes(needle));
}

/** What a scene's card can be found by: its title and aliases, its conflict, and whose point of view it is told from. */
export function sceneSearchWords(scene: { title: string; aliases: readonly string[]; conflict: string; povName: string }): string {
	return [scene.title, ...scene.aliases, scene.conflict, scene.povName].join('\n');
}
