import { parseWikiLink } from '../domain/wikilink';

/** Sorts a scene's links for display without changing their stored spelling or order. */
export function orderLinkedManuscript(
	links: readonly string[],
	manuscriptPaths: readonly string[],
	resolveTarget: (target: string) => string | null,
): string[] {
	const positions = new Map(manuscriptPaths.map((path, index) => [path, index]));
	return orderManuscriptReferences(links, positions, (raw) => {
		const link = parseWikiLink(raw);
		return link === null ? null : resolveTarget(link.target);
	});
}

/** Reuses one stream rank map across all the scene cards in a project snapshot. */
export function orderManuscriptReferences<Link>(
	links: readonly Link[],
	positions: ReadonlyMap<string, number>,
	resolvePath: (link: Link) => string | null,
): Link[] {
	return links
		.map((link, index) => {
			const path = resolvePath(link);
			return {
				link,
				index,
				position: (path === null ? undefined : positions.get(path)) ?? Number.MAX_SAFE_INTEGER,
			};
		})
		.sort((left, right) => left.position - right.position || left.index - right.index)
		.map(({ link }) => link);
}

/** The two ends of a scene's manuscript span, with its middle kept in the modal. */
export function linkedManuscriptPreview<Link>(
	orderedLinks: readonly Link[],
): { shown: readonly Link[]; remaining: number } {
	return {
		shown: orderedLinks.length <= 2
			? orderedLinks
			: [...orderedLinks.slice(0, 1), ...orderedLinks.slice(-1)],
		remaining: Math.max(0, orderedLinks.length - 2),
	};
}
