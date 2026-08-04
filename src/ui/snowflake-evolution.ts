import { setIcon } from 'obsidian';

interface SnowflakePoint {
	x: number;
	y: number;
}

export function renderSnowflakeEvolution(container: HTMLElement): void {
	const namespace = 'http://www.w3.org/2000/svg';
	const svg = container.doc.createElementNS(namespace, 'svg');
	svg.setAttribute('viewBox', '0 0 100 100');
	svg.setAttribute('focusable', 'false');
	svg.classList.add('snowflake-method-snowflake-evolution');
	container.append(svg);

	for (const [iteration, className] of [
		[1, 'snowflake-method-snowflake-evolution-star'],
		[2, 'snowflake-method-snowflake-evolution-koch-one'],
		[3, 'snowflake-method-snowflake-evolution-koch-two'],
	] as const) {
		const path = container.doc.createElementNS(namespace, 'path');
		path.setAttribute('d', createKochSnowflakePath(iteration));
		path.setAttribute('vector-effect', 'non-scaling-stroke');
		path.classList.add(
			'snowflake-method-snowflake-evolution-stage',
			className,
		);
		svg.append(path);
	}

	const fallback = container.createSpan({
		cls: 'snowflake-method-snowflake-evolution-fallback',
	});
	setIcon(fallback, 'snowflake');
}

function createKochSnowflakePath(iterations: number): string {
	let points: SnowflakePoint[] = [
		{ x: 50, y: 8 },
		{ x: 86, y: 70 },
		{ x: 14, y: 70 },
	];

	for (let iteration = 0; iteration < iterations; iteration += 1) {
		const next: SnowflakePoint[] = [];
		for (let index = 0; index < points.length; index += 1) {
			const start = points[index];
			const end = points[(index + 1) % points.length];
			if (start === undefined || end === undefined) continue;
			const first = interpolatePoint(start, end, 1 / 3);
			const second = interpolatePoint(start, end, 2 / 3);
			const dx = second.x - first.x;
			const dy = second.y - first.y;
			const peak = {
				x: first.x + dx * 0.5 + dy * (Math.sqrt(3) / 2),
				y: first.y - dx * (Math.sqrt(3) / 2) + dy * 0.5,
			};
			next.push(start, first, peak, second);
		}
		points = next;
	}

	return `${points
		.map(
			(point, index) =>
				`${index === 0 ? 'M' : 'L'} ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`,
		)
		.join(' ')} Z`;
}

function interpolatePoint(
	start: SnowflakePoint,
	end: SnowflakePoint,
	ratio: number,
): SnowflakePoint {
	return {
		x: start.x + (end.x - start.x) * ratio,
		y: start.y + (end.y - start.y) * ratio,
	};
}

function formatCoordinate(value: number): string {
	return value.toFixed(3).replace(/\.?(?:0+)$/u, '');
}
