import { setIcon, setTooltip } from 'obsidian';

/** The two faces: the writing count, and the writing session's clock. */
export type WritingFaceKind = 'count' | 'session';

/**
 * Where a face stands: the status bar, whose item the app makes and the face
 * dresses, or a toolbar, where the face is a button of the bar's own kind.
 */
export type WritingFaceVariant = 'status-bar' | 'toolbar';

/** What the count face says: the number's line, and the breakdown behind it. */
export interface CountLook {
	line: string;
	breakdown: string;
}

/** What the session face says: its icon, its clock, its tooltip and its state. */
export interface SessionLook {
	icon: string;
	line: string;
	tooltip: string;
	paused: boolean;
	idle: boolean;
	break: boolean;
}

export interface WritingFacesDeps {
	openCountMenu(event: MouseEvent): void;
	openSessionMenu(event: MouseEvent): void;
	/**
	 * A face has just appeared. The owner brings its words up to date:
	 * nothing is counted or ticked while no face shows, so the first face
	 * finds stale words and asks for fresh ones.
	 */
	appeared(kind: WritingFaceKind): void;
}

interface Face {
	kind: WritingFaceKind;
	el: HTMLElement;
	icon: HTMLElement;
	text: HTMLElement;
}

export const WRITING_FACE_CLASS = 'snowflake-method-writing-face';
export const TOOLBAR_FACES_CLASS = 'snowflake-method-toolbar-faces';

/**
 * The writing count and the writing session, shown wherever a face for them
 * is mounted. The desktop mounts both in the status bar; mobile has no status
 * bar (the app hides it), so a stream or a dressed note mounts them on its
 * toolbar instead. Every face shows the same look, the last one painted, and
 * a face mounted later takes it at once.
 */
export class WritingFaces {
	private readonly faces = new Set<Face>();
	private count: CountLook | null = null;
	private session: SessionLook | null = null;

	constructor(private readonly deps: WritingFacesDeps) {}

	/**
	 * A face mounted on a host in the host's own manner, with its release.
	 * The status bar variant takes the item itself as the face; the toolbar
	 * variant adds a button to the bar.
	 */
	mount(host: HTMLElement, kind: WritingFaceKind, variant: WritingFaceVariant): () => void {
		const own = kind === 'count' ? 'snowflake-method-word-count' : 'snowflake-method-session';
		const el =
			variant === 'status-bar'
				? host
				: host.createEl('button', {
						cls: `clickable-icon snowflake-method-toolbar-button ${WRITING_FACE_CLASS} is-${kind}`,
						attr: { type: 'button' },
					});
		el.addClass(own);
		if (variant === 'status-bar') el.addClass('mod-clickable');
		const icon = el.createSpan({ cls: `${own}-icon` });
		setIcon(icon, kind === 'count' ? 'snowflake' : 'clock');
		const text = el.createSpan();
		const open = (event: MouseEvent): void => {
			if (kind === 'count') this.deps.openCountMenu(event);
			else this.deps.openSessionMenu(event);
		};
		el.addEventListener('click', open);
		const face: Face = { kind, el, icon, text };
		this.faces.add(face);
		this.paintFace(face);
		this.deps.appeared(kind);
		return () => {
			if (!this.faces.delete(face)) return;
			el.removeEventListener('click', open);
			if (variant === 'toolbar') el.remove();
		};
	}

	/** Whether a face of a kind is on a page now, so what it says would be seen. */
	anyShown(kind: WritingFaceKind): boolean {
		for (const face of this.faces) {
			if (face.kind === kind && face.el.isConnected) return true;
		}
		return false;
	}

	/** The count on every count face, or none of them while there is nothing to count. */
	paintCount(look: CountLook | null): void {
		this.count = look;
		for (const face of this.faces) if (face.kind === 'count') this.paintFace(face);
	}

	paintSession(look: SessionLook): void {
		this.session = look;
		for (const face of this.faces) if (face.kind === 'session') this.paintFace(face);
	}

	private paintFace(face: Face): void {
		if (face.kind === 'count') {
			const look = this.count;
			if (look === null) {
				face.el.hide();
				return;
			}
			face.text.setText(look.line);
			// The breakdown is the face's name as well as its tooltip: the app
			// keeps a tooltip in `aria-label`, so a label written after this
			// one would take the numbers away from the pointer and leave
			// nothing in their place.
			setTooltip(face.el, look.breakdown);
			face.el.show();
			return;
		}
		const look = this.session;
		if (look === null) return;
		setIcon(face.icon, look.icon);
		face.text.setText(look.line);
		face.el.toggleClass('is-paused', look.paused);
		face.el.toggleClass('is-idle', look.idle);
		face.el.toggleClass('is-break', look.break);
		setTooltip(face.el, look.tooltip);
	}
}
