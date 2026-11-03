import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import SettingsPlugins from './plugins';

const meta: Meta<typeof SettingsPlugins> = {
	title: 'Page/Main/Settings/Plugins',
	component: SettingsPlugins,
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
