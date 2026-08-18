/**
 * Writing surfaces: where writing happens, as a session sees it.
 *
 * A session that watched only CodeMirror would call an author idle while they
 * fill in a character's storyline on the dashboard, which is the Snowflake
 * method's own work. So the session watches surfaces instead: the Markdown
 * editor, the manuscript stream, and this plugin's own dashboard and modal
 * fields all report the same way.
 *
 * Surfaces answer one question, and they answer it for Focus and Idle alone:
 * is the author writing. What was written is a different question with a
 * different source -- a note on disk. Text sitting in a form has not changed
 * the project yet, and a form the author cancels never will, so a surface
 * moves the clock and never added, deleted or net.
 */

export const WRITING_SURFACE_KINDS = [
	'markdown-editor',
	'manuscript-segment',
	'dashboard-field',
	'modal-field',
] as const;
export type WritingSurfaceKind = (typeof WRITING_SURFACE_KINDS)[number];

/** One report of meaningful editing on a writing surface. */
export interface WritingSurfaceActivity {
	kind: WritingSurfaceKind;
	/**
	 * Any path inside the project the writing belongs to: the note an editor
	 * holds, or the project a form was opened over. A report that can name
	 * neither belongs to no session and is dropped.
	 */
	path: string | null;
}
