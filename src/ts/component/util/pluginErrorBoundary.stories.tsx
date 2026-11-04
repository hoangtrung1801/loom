import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import PluginErrorBoundary from './pluginErrorBoundary';

const Broken = () => {
	throw new Error('Something went wrong inside the plugin');
};

const meta: Meta<typeof PluginErrorBoundary> = {
	title: 'Util/PluginErrorBoundary',
	component: PluginErrorBoundary,
	tags: ['autodocs'],
};

export { meta as default };
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
	args: {
		pluginId: 'sample',
		children: <div>Plugin content</div>,
	},
};

export const Failed: Story = {
	args: {
		pluginId: 'sample',
		children: <Broken />,
	},
};
