import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import MediaHtml from './html';

const meta: Meta<typeof MediaHtml> = {
	title: 'Util/Media/Html',
	component: MediaHtml,
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div style={{ width: 600 }}>
				<Story />
			</div>
		),
	],
};

export { meta as default };
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		src: 'data:text/html,%3Ch1%3EHello%3C%2Fh1%3E',
		title: 'page.html',
	},
};

export const TooLarge: Story = {
	args: {
		src: 'data:text/html,%3Ch1%3EHello%3C%2Fh1%3E',
		title: 'page.html',
		sizeInBytes: 50 * 1024 * 1024,
	},
};
