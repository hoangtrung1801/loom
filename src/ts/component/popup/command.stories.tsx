import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import PopupCommand from './command';

const meta: Meta<typeof PopupCommand> = {
	title: 'Popup/Command',
	component: PopupCommand,
	tags: ['autodocs'],
};

export { meta as default };
type Story = StoryObj<typeof meta>;

// No plugin registers a command in Storybook, so the empty state shows
export const Default: Story = {
	args: {
		id: 'command',
		param: {},
		close: () => {},
		position: () => {},
	},
};
