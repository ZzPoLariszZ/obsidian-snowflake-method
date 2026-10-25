/**
 * A press on a control that must not take the caret out of the editor it
 * acts on: the toolbars' buttons, a picker's chevron, the find bar's.
 *
 * With a mouse the focus moves on `mousedown`, and preventing that default
 * keeps the caret where it was. A touch is another matter: the focus moves
 * with the `mousedown` the browser makes after `touchend`, and preventing
 * the `touchend` default keeps the caret and the keyboard both, but ends the
 * made click with it, so a tap acts from the touch itself. Pointer events
 * are prevented too, for whatever would read the press off those.
 */

/** How far a finger may drift and still be tapping rather than scrolling. */
export const TAP_SLOP_PX = 10;
/** How long after a tap that acted the browser's own click of it is still ignored. */
export const TAP_AFTERMATH_MS = 700;

interface Touch {
	x: number;
	y: number;
	moved: boolean;
}

export function wireCaretKeepingPress(control: HTMLElement, act: (event: MouseEvent) => void): void {
	const win = control.ownerDocument.defaultView;
	let touch: Touch | null = null;
	let actedAt: number | null = null;
	const disabled = (): boolean =>
		('disabled' in control && (control as { disabled?: unknown }).disabled === true) ||
		control.getAttribute('aria-disabled') === 'true';
	control.addEventListener('mousedown', (event) => {
		event.preventDefault();
	});
	control.addEventListener('pointerdown', (event) => {
		if (event.pointerType !== 'mouse') event.preventDefault();
	});
	control.addEventListener(
		'touchstart',
		(event) => {
			const point = event.touches[0];
			touch =
				event.touches.length === 1 && point !== undefined
					? { x: point.clientX, y: point.clientY, moved: false }
					: null;
		},
		{ passive: true },
	);
	control.addEventListener(
		'touchmove',
		(event) => {
			const point = event.touches[0];
			if (touch === null || point === undefined) return;
			if (Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > TAP_SLOP_PX) touch.moved = true;
		},
		{ passive: true },
	);
	control.addEventListener('touchcancel', () => {
		touch = null;
	});
	control.addEventListener('touchend', (event) => {
		const press = touch;
		touch = null;
		if (press === null || press.moved || event.touches.length > 0 || disabled()) return;
		event.preventDefault();
		actedAt = Date.now();
		const point = event.changedTouches[0];
		act(
			new MouseEvent('click', {
				bubbles: false,
				cancelable: true,
				clientX: point?.clientX ?? press.x,
				clientY: point?.clientY ?? press.y,
				...(win === null ? {} : { view: win }),
			}),
		);
	});
	control.addEventListener('click', (event) => {
		if (actedAt !== null && Date.now() - actedAt < TAP_AFTERMATH_MS) {
			event.preventDefault();
			return;
		}
		act(event);
	});
}
