/**
 * What a view of the corkboard deals: which notes it shows, how they are
 * searched, gathered and filtered, the deck its cards come from, and what
 * the board asks the host to do with one. The board itself knows only cards
 * and places: it is dealt a scene view, a character view or a view of one
 * worldbuilding kind through this one contract, so a change to how cards
 * are laid out, windowed or dragged reaches every view at once.
 */

import type { MemberMoveTarget, RankRevisionChange } from '../services';
import type { GroupValue } from './corkboard-layout';
import type { FilterRow } from './filter-rows';
import type { CardMember, MemberCard, MemberCardDeck, MemberCardDeps, MemberCardPart } from './member-card';
import type { CorkboardMode } from './story-structure-state';
import type { ProjectDashboardModel } from './view-model';

export type { MemberMoveTarget } from '../services';

/** What the funnel and the search answer: a note and its place in the order. */
export interface ShownMember<Member> {
	member: Member;
	index: number;
}

/** What the board hands a deal's deck: the deps every deck takes, less what the deal supplies itself. */
export type BoardDeckDeps<
	Member extends CardMember,
	Extras extends object,
	Card extends MemberCard<Member> & Extras,
> = Pick<
	MemberCardDeps<Member, Extras, Card>,
	'app' | 't' | 'notice' | 'refresh' | 'projectPath' | 'readOnly' | 'unloading' | 'dragAllowed' | 'menu' | 'extend' | 'paneShown'
>;

/** The questions a view's funnel asks, and what they do to the order. */
export interface DealFilters<Filters, Extra> {
	make(): Filters;
	clear(filters: Filters): void;
	/** Whether any question is answered, which the funnel's button and the count show. */
	active(filters: Filters): boolean;
	/** Whether an answer leaves gaps in the order, which turns the neighbourly actions off; a continuous range does not. */
	gapping(filters: Filters): boolean;
	/** Drops an answer the project can no longer give. */
	reconcile(filters: Filters, model: ProjectDashboardModel): void;
	/** What the rows need beyond the model, read as the funnel opens. */
	extra(model: ProjectDashboardModel): Promise<Extra>;
	rows(model: ProjectDashboardModel, filters: Filters, extra: Extra): FilterRow[];
}

export interface CorkboardDeal<
	Member extends CardMember,
	Extras extends object,
	Part extends string,
	Filters,
	Extra = unknown,
> {
	/** The view the deal draws, as the tab remembers it. */
	view: string;
	/** The type a card leaves the board under; a type of its own per kind, so a card never lands on another kind's board. */
	dragType: string;
	/** A card's height per style in rem, with no pane on it. */
	cardHeight: Readonly<Record<CorkboardMode, number>>;
	/** The styles that stand the picture pane on the card: a square as wide as the card, added to the style's height. */
	paned: readonly CorkboardMode[];
	words: {
		search: string;
		add: string;
		insertBefore: string;
		insertAfter: string;
		empty: string;
	};
	/** Notes the model's lookups afresh; called with every model the board paints from, before any other read of it. */
	index(model: ProjectDashboardModel | null): void;
	/** The head of a full paint, for what the deal resolves once per paint. */
	beginPaint(): void;
	/** The view's notes in their own order. */
	members(model: ProjectDashboardModel): readonly Member[];
	membersById(): ReadonlyMap<string, Member>;
	name(member: Member): string;
	filters: DealFilters<Filters, Extra>;
	/** The notes the search and the funnel let through, each with its place in the order. */
	shown(members: readonly Member[], query: string, filters: Filters): ShownMember<Member>[];
	groupFields: readonly string[];
	groupLabel(field: string): string;
	groupValues(member: Member, field: string, model: ProjectDashboardModel): GroupValue[];
	/** The label of the group for notes with no value of the field. */
	noneLabel(field: string): string;
	deck<Card extends MemberCard<Member> & Extras>(
		deps: BoardDeckDeps<Member, Extras, Card>,
	): MemberCardDeck<Member, Card, Part>;
	/** The parts of a card the focus can stand on, by class. */
	partClasses: readonly [Part | MemberCardPart, string][];
	reorder(
		id: string,
		target: MemberMoveTarget,
		projectPath: string,
		adopt: (change: RankRevisionChange) => void,
	): Promise<void>;
	/** Opens the kind's create form, the note to land after the index, or at the end for null; answers the id made. */
	openCreate(afterIndex: number | null, projectPath: string, onSaved: () => void): Promise<string | null>;
	openEdit(member: Member, projectPath: string, onSaved: () => void): Promise<unknown>;
	open(member: Member): Promise<void>;
	delete(member: Member, projectPath: string): Promise<void>;
}
