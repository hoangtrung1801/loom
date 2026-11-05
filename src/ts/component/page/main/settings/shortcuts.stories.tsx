import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import SettingsShortcuts from './shortcuts';

const meta: Meta<typeof SettingsShortcuts> = {
	title: 'Page/Main/Settings/Shortcuts',
	component: SettingsShortcuts,
	tags: ['autodocs'],
	parameters: {
		layout: 'fullscreen',
	},
};

export { meta as default };
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		isPopup: false,
	},
};
