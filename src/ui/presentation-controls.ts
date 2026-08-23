import {
	setTooltip,
	type App,
	type ColorComponent,
	type DropdownComponent,
	type ExtraButtonComponent,
	type Setting,
	type SliderComponent,
	type ToggleComponent,
} from 'obsidian';

import { fontFamilyValue, nearestStop } from '../domain';
import {
	fontFamilyRenders,
	loadLocalFontFamilies,
	localFontFamilies,
} from './font-families';
import { buildOptionField, type PickerOption } from './option-picker';

/**
 * The controls that dress the manuscript page, built the same way wherever
 * they are offered: in the settings tab, and in the popover the stream opens
 * over the manuscript itself. Each is told the value in force and whom to
 * tell when the author picks another, and hands back a way to show a value
 * that changed elsewhere — so the two places never disagree.
 */
export interface ControlHandle<T> {
	/** Shows a value that changed elsewhere. A repeat changes nothing. */
	sync(value: T): void;
	/** Takes down whatever the control leaves outside its own row. */
	destroy?(): void;
}

export interface StopSliderSpec {
	/** The values the handle stops at, in order. */
	stops: readonly number[];
	value: number;
	/** What the button beside the slider puts back: the theme's own, or none. */
	resetValue: number;
	resetLabel: string;
	/**
	 * The theme variable the stylesheet falls back to while the setting is the
	 * theme's own, if it has one. Read to place the handle, never to store.
	 */
	themeVar?: string;
	/** The stop in words, for the value beside the slider. */
	format(value: number): string;
	onPick(value: number): void;
}

/**
 * A slider over a list of stops rather than a range: the handle moves by
 * index, and the value beside it is written in words rather than as the
 * index. Answered while the handle moves, so the page follows the drag.
 *
 * The rail is real values from end to end. What the theme would do is not a
 * stop but the button on the slider's left, which puts the setting back to
 * it -- and while the setting is there, the handle waits at the stop nearest
 * what the theme is already doing, so a drag starts from what is on the page.
 */
export function addStopSlider(
	setting: Setting,
	spec: StopSliderSpec,
): ControlHandle<number> {
	setting.settingEl.addClass('snowflake-method-presentation-row');
	const value = setting.controlEl.createSpan({
		cls: 'snowflake-method-presentation-value',
	});
	const first = spec.stops[0] ?? 0;
	// A setting of zero is the theme's own wherever zero is not itself a stop:
	// no indent is a real value, no font size is not.
	const atTheme = (stop: number): boolean => stop <= 0 && !spec.stops.includes(0);
	const themeStop = (): number => {
		if (spec.themeVar === undefined) return first;
		const el = setting.settingEl;
		const measured = Number.parseFloat(
			el.win.getComputedStyle(el).getPropertyValue(spec.themeVar),
		);
		return Number.isFinite(measured) ? measured : first;
	};
	const indexOf = (stop: number): number =>
		nearestStop(spec.stops, atTheme(stop) ? themeStop() : stop);
	let current = spec.value;
	let slider: SliderComponent | null = null;
	let reset: ExtraButtonComponent | null = null;
	// Raised while the handle is being put somewhere rather than dragged
	// there, so showing a value that changed elsewhere never reads as a pick.
	let quiet = false;
	const put = (stop: number): void => {
		if (slider === null) return;
		const index = indexOf(stop);
		if (slider.getValue() === index) return;
		quiet = true;
		slider.setValue(index);
		quiet = false;
	};
	const show = (stop: number): void => {
		current = stop;
		// A value stored outside the stops reads as the stop it snaps to, and
		// is not written back until the handle moves.
		value.setText(spec.format(atTheme(stop) ? stop : (spec.stops[indexOf(stop)] ?? stop)));
		// Nothing to put back while the measure is already where the button
		// would take it, and the app dims an icon that says it is disabled.
		const spent = stop === spec.resetValue;
		if (reset !== null) {
			reset.setDisabled(spent);
			reset.extraSettingsEl.setAttribute('aria-disabled', String(spent));
		}
	};
	setting.addExtraButton((component) => {
		reset = component;
		component.extraSettingsEl.addClass('snowflake-method-presentation-reset');
		component
			.setIcon('rotate-ccw')
			.setTooltip(spec.resetLabel)
			.onClick(() => {
				if (current === spec.resetValue) return;
				show(spec.resetValue);
				put(spec.resetValue);
				spec.onPick(spec.resetValue);
			});
	});
	setting.addSlider((component) => {
		slider = component;
		component
			.setLimits(0, spec.stops.length - 1, 1)
			.setValue(indexOf(spec.value))
			.setInstant(true)
			.setDisplayFormat((index) => spec.format(spec.stops[index] ?? first))
			.onChange((index) => {
				if (quiet) return;
				const stop = spec.stops[index];
				if (stop === undefined) return;
				show(stop);
				spec.onPick(stop);
			});
	});
	show(spec.value);
	return {
		sync: (next) => {
			show(next);
			put(next);
		},
	};
}

export interface TintSwatchesSpec {
	/** '' for the theme's own, else a lowercase hex color. */
	value: string;
	presets: readonly { hex: string; label: string }[];
	labels: { themeDefault: string; custom: string };
	onPick(value: string): void;
}

/**
 * The page's ground for one mode: the theme's own, the tints, and any
 * color. Round swatches for the first, and past a divider, the system's
 * color picker as a chip of its own shape -- so the one control that opens
 * onto every color is not read as a sixth tint. Whichever is in force is
 * marked, and the chip shows the spectrum until it is the one chosen.
 */
export function addTintSwatches(
	setting: Setting,
	spec: TintSwatchesSpec,
): ControlHandle<string> {
	setting.settingEl.addClass('snowflake-method-presentation-row');
	const strip = setting.controlEl.createDiv({
		cls: 'snowflake-method-tint-swatches',
		attr: { role: 'radiogroup' },
	});
	const swatches: { value: string; el: HTMLButtonElement }[] = [];
	const swatch = (value: string, label: string, hex: string | null): void => {
		const el = strip.createEl('button', {
			cls: 'snowflake-method-tint-swatch',
			attr: { type: 'button', role: 'radio', 'aria-label': label },
		});
		if (hex === null) el.addClass('is-theme');
		else el.setCssProps({ '--snowflake-method-swatch': hex });
		setTooltip(el, label);
		el.addEventListener('click', () => {
			spec.onPick(value);
		});
		swatches.push({ value, el });
	};
	swatch('', spec.labels.themeDefault, null);
	for (const preset of spec.presets) swatch(preset.hex, preset.label, preset.hex);
	strip.createSpan({ cls: 'snowflake-method-tint-divider' });
	const custom = strip.createDiv({ cls: 'snowflake-method-tint-custom' });
	let picker: ColorComponent | null = null;
	setting.addColorPicker((component) => {
		picker = component;
		// The picker has to hold some color; while the page is on a swatch it
		// holds the first tint, out of sight behind the chip's spectrum and
		// ready to be taken somewhere else.
		component
			.setValue(spec.value.length > 0 ? spec.value : (spec.presets[0]?.hex ?? '#ffffff'))
			.onChange((hex) => {
				spec.onPick(hex.toLowerCase());
			});
	});
	// The component keeps its input to itself; it is the last thing added to
	// the row, and it goes into the chip at the end of the strip.
	const added = setting.controlEl.lastElementChild;
	const pickerEl = added?.instanceOf(HTMLInputElement) === true ? added : null;
	if (pickerEl !== null) {
		custom.appendChild(pickerEl);
		pickerEl.addClass('snowflake-method-tint-picker');
		pickerEl.setAttribute('aria-label', spec.labels.custom);
		setTooltip(pickerEl, spec.labels.custom);
	}
	const mark = (current: string): void => {
		const onSwatch = swatches.some((entry) => entry.value === current);
		for (const entry of swatches) {
			const chosen = entry.value === current;
			entry.el.toggleClass('is-selected', chosen);
			entry.el.setAttribute('aria-checked', String(chosen));
		}
		custom.toggleClass('is-selected', !onSwatch);
		custom.toggleClass('is-empty', onSwatch);
		if (
			picker !== null &&
			!onSwatch &&
			current.length > 0 &&
			picker.getValue() !== current
		) {
			picker.setValue(current);
		}
	};
	mark(spec.value);
	return { sync: mark };
}

export interface FontFamilySpec {
	value: string;
	/** The first row of the list, and what an unset field reads as. */
	themeLabel: string;
	placeholder: string;
	/** Names the field for the screen reader and the chevron. */
	label: string;
	/** The faces set lately, newest first, offered above the rest. */
	recent: () => readonly string[];
	/** The two headings the list is offered under. */
	sections: { recent: string; all: string };
	/** Offers to take a name the machine has no font for, as typed. */
	useLabel(typed: string): string;
	/** Says what is wrong with a face this machine does not have. */
	missingLabel(family: string): string;
	onPick(value: string): void;
}

/**
 * The font, picked from what the machine has rather than spelled out: the
 * theme's own first, then every family installed, filtered by whatever is
 * typed into the box. Built from the picker every other field of this plugin
 * uses, so it opens, filters and reads the same way they do.
 *
 * A face the list does not have is still offered as typed, from the row at
 * the foot of the list, but only when this machine can actually set text in
 * it: the browser's list is taken once per session and misses a font
 * installed since, and on a phone there is no list at all. A name nothing
 * would render is not offered, because a font the machine does not have is
 * a setting that does nothing.
 */
export function addFontFamilyPicker(
	app: App,
	setting: Setting,
	spec: FontFamilySpec,
): ControlHandle<string> {
	setting.settingEl.addClass('snowflake-method-presentation-row');
	const host = setting.controlEl.createDiv({
		cls: 'snowflake-method-font-picker',
	});
	// The answer lands in the module and the list reads it when opened, so a
	// field built before the machine answers fills itself in by the time it is
	// asked. Nothing waits on it.
	const win = setting.settingEl.win;
	void loadLocalFontFamilies(win);
	// Asked again on the way in only when nothing came of the first ask: the
	// browser lists a machine's fonts only for a window its owner has just
	// acted in, so a field built without that -- a panel opened by a command, a
	// page drawn on load -- may have been refused, and reaching for the field is
	// the author acting. A list already in hand is not asked for again, since
	// the browser would only hand back the same one.
	host.addEventListener('pointerdown', () => {
		void loadLocalFontFamilies(win);
	});
	let current = spec.value;
	const options = (): PickerOption[] => {
		const installed = localFontFamilies();
		// The theme's own opens the list, unheaded: it is what the manuscript
		// wears until something else is chosen, not one of the machine's faces.
		const rows: PickerOption[] = [{ value: '', label: spec.themeLabel }];
		for (const face of spec.recent()) {
			rows.push({ value: face, label: face, section: spec.sections.recent });
		}
		for (const family of installed) {
			rows.push({ value: family, label: family, section: spec.sections.all });
		}
		// Whatever the setting holds stays on offer, so the field can always
		// show what it is holding -- marked only when this machine really has
		// no such face, rather than whenever the list happens to lack it.
		if (
			current.length > 0 &&
			!installed.includes(current) &&
			!spec.recent().includes(current)
		) {
			rows.push({
				value: current,
				label: current,
				section: spec.sections.all,
				missing: !fontFamilyRenders(win, current),
			});
		}
		return rows;
	};
	const field = buildOptionField(app, host, {
		options,
		label: spec.label,
		placeholder: spec.placeholder,
		emptyPlaceholder: spec.placeholder,
		missingLabel: (face) => spec.missingLabel(face),
		// Every name is written in its own face, in the list and in the box, so
		// the list is a specimen sheet rather than a column of names.
		dress: (el, option) => {
			const face = fontFamilyValue(option?.value ?? '');
			if (face.length === 0) el.style.removeProperty('font-family');
			else el.style.setProperty('font-family', face);
		},
		create: {
			label: (typed) => spec.useLabel(typed),
			offers: (typed) => fontFamilyRenders(win, typed),
			run: (typed) => Promise.resolve({ value: typed, label: typed }),
		},
		value: () => current,
		choose: (value) => {
			current = value;
			spec.onPick(value);
		},
	});
	return {
		sync: (next) => {
			if (next === current) return;
			current = next;
			// The field reads the value back through the same path it shows one
			// on a pick, so the box, its dress and its mark all follow.
			field.refresh();
		},
		destroy: () => {
			field.destroy();
		},
	};
}

export interface ChoicePickerSpec<T extends string> {
	value: T;
	/** The choices in order, each with the words it is offered by. */
	options: readonly { value: T; label: string }[];
	onPick(value: T): void;
}

/** One of a few named choices, from a list: the guide style, the alignment. */
export function addChoicePicker<T extends string>(
	setting: Setting,
	spec: ChoicePickerSpec<T>,
): ControlHandle<T> {
	setting.settingEl.addClass('snowflake-method-presentation-row');
	const known = new Set<string>(spec.options.map((option) => option.value));
	let dropdown: DropdownComponent | null = null;
	setting.addDropdown((component) => {
		dropdown = component;
		for (const option of spec.options) {
			component.addOption(option.value, option.label);
		}
		component.setValue(spec.value).onChange((picked) => {
			if (known.has(picked)) spec.onPick(picked as T);
		});
	});
	return {
		sync: (next) => {
			if (dropdown !== null && dropdown.getValue() !== next) {
				dropdown.setValue(next);
			}
		},
	};
}

export interface ToggleSpec {
	value: boolean;
	onPick(value: boolean): void;
}

/** On or off. */
export function addToggleControl(
	setting: Setting,
	spec: ToggleSpec,
): ControlHandle<boolean> {
	setting.settingEl.addClass('snowflake-method-presentation-row');
	let toggle: ToggleComponent | null = null;
	setting.addToggle((component) => {
		toggle = component;
		component.setValue(spec.value).onChange((on) => {
			spec.onPick(on);
		});
	});
	return {
		sync: (next) => {
			if (toggle !== null && toggle.getValue() !== next) toggle.setValue(next);
		},
	};
}
