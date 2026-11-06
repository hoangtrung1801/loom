import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CanvasController, Scene, Tool } from 'Lib/canvas';
import CanvasToolbar from './toolbar';

const meta: Meta<typeof CanvasToolbar> = {
	title: 'Canvas/Toolbar',
	component: CanvasToolbar,
	tags: [ 'autodocs' ],
	parameters: { layout: 'fullscreen' },
	decorators: [
		Story => <div className="canvasWrap" style={{ position: 'relative', height: 320 }}><Story /></div>,
	],
	args: {
		controller: new CanvasController(new Scene()),
		tool: Tool.Select,
		onAddObject: () => {},
		onMenu: () => {},
		onLibrary: () => {},
		onChange: () => {},
	},
};

export { meta as default };
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Readonly: Story = {
	args: { readonly: true },
};

export const Locked: Story = {
	args: { controller: Object.assign(new CanvasController(new Scene()), { locked: true }), tool: Tool.Rect },
};
