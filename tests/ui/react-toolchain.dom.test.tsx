// @vitest-environment happy-dom

/**
 * The one corner of the suite that runs on a real document. Everything else
 * is read on the hand-built surface, which React cannot stand on; this file
 * says only that the toolchain the canvas needs is in working order: that a
 * `.tsx` is compiled, that React draws into a document, and that React Flow
 * lays out nodes it was told the measures of without measuring anything.
 */

import { ReactFlow, ReactFlowProvider, type Edge, type Node } from '@xyflow/react';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

declare global {
	// React asks for this before it lets `act` stand in for the scheduler.
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];

function mount(element: ReactElement): HTMLElement {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => {
		root.render(element);
	});
	mounted.push({ root, host });
	return host;
}

afterEach(() => {
	for (const { root, host } of mounted.splice(0)) {
		act(() => {
			root.unmount();
		});
		host.remove();
	}
});

describe('the canvas toolchain', () => {
	it('compiles a component and draws it into a document', () => {
		const Greeting = ({ name }: { name: string }): ReactElement => <p className="greeting">Hello, {name}</p>;
		const host = mount(<Greeting name="canvas" />);
		expect(host.querySelector('.greeting')?.textContent).toBe('Hello, canvas');
	});

	it('lays out nodes it was told the measures of, and draws the line between them', () => {
		// A handle is a box one unit each way standing just inside its side, so
		// the line ends on the side itself: the engine reads a right handle's
		// end off the box's far edge and a left one's off its near edge.
		const handles = (width: number, height: number): Node['handles'] => [
			{ id: 'right', type: 'source', position: 'right' as never, x: width - 1, y: height / 2 - 0.5, width: 1, height: 1 },
			{ id: 'left', type: 'source', position: 'left' as never, x: 0, y: height / 2 - 0.5, width: 1, height: 1 },
		];
		const nodes: Node[] = [
			{ id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' }, width: 100, height: 40, measured: { width: 100, height: 40 }, handles: handles(100, 40) },
			{ id: 'b', position: { x: 300, y: 100 }, data: { label: 'B' }, width: 100, height: 40, measured: { width: 100, height: 40 }, handles: handles(100, 40) },
		];
		const edges: Edge[] = [{ id: 'a-b', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' }];
		const host = mount(
			<div style={{ width: 800, height: 600 }}>
				<ReactFlowProvider>
					<ReactFlow
						nodes={nodes}
						edges={edges}
						width={800}
						height={600}
						connectionMode={'loose' as never}
						deleteKeyCode={null}
						selectionKeyCode={null}
						multiSelectionKeyCode={null}
						panActivationKeyCode={null}
						zoomActivationKeyCode={null}
						proOptions={{ hideAttribution: true }}
						onError={() => undefined}
					/>
				</ReactFlowProvider>
			</div>,
		);
		expect(host.querySelectorAll('.react-flow__node')).toHaveLength(2);
		const path = host.querySelector('.react-flow__edge-path');
		expect(path).not.toBeNull();
		// From the right side of the first to the left side of the second, by the measures handed in.
		expect(path?.getAttribute('d')).toMatch(/^M\s*100[ ,]+20\b/u);
		expect(path?.getAttribute('d')).toMatch(/300[ ,]+120\s*$/u);
		expect(host.querySelector('.react-flow__attribution')).toBeNull();
	});
});
