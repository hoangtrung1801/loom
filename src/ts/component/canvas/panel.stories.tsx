import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CanvasController, ElementType, Scene, Tool, defaultElement } from 'Lib/canvas';
import CanvasPanel from './panel';

const make = (type: ElementType) => {
	const scene = new Scene();
	const controller = new CanvasController(scene);

	scene.load([ defaultElement(type, 'a', 'i', { x: 0, y: 0, w: 160, h: 100, v: 1, roughness: 1, fill: 'blue', fillStyle: 'hachure', points: [ [ 0, 0 ], [ 160, 100 ] ] }) ]);
	scene.setSelection([ 'a' ]);
	return controller;
};

const meta: Meta<typeof CanvasPanel> = {
	title: 'Canvas/Panel',
	component: CanvasPanel,
	tags: [ 'autodocs' ],
	parameters: { layout: 'fullscreen' },
	decorators: [
		Story => <div className="canvasWrap" style={{ position: 'relative', height: 640 }}><Story /></div>,
	],
};

export { meta as default };
type Story = StoryObj<typeof meta>;

export const Shape: Story = {
	args: { controller: make(ElementType.Rect), tool: Tool.Select, onChange: () => {} },
};

export const Text: Story = {
	args: { controller: make(ElementType.Text), tool: Tool.Select, onChange: () => {} },
};

export const Arrow: Story = {
	args: { controller: make(ElementType.Arrow), tool: Tool.Select, onChange: () => {} },
};

/** Nothing selected and a drawing tool active: edits the style new elements start with. */
export const Defaults: Story = {
	args: { controller: new CanvasController(new Scene()), tool: Tool.Diamond, onChange: () => {} },
};
