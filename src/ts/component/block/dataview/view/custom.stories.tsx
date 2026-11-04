import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import ViewCustom from './custom';
import * as I from 'Interface';
import * as M from 'Model';

const noop = () => {};

const meta: Meta<typeof ViewCustom> = {
	title: 'Block/Dataview/View/Custom',
	component: ViewCustom,
	tags: ['autodocs'],
};

export { meta as default };
type Story = StoryObj<typeof meta>;

// No plugin provides the view, so it shows the "needs plugin" state
export const MissingPlugin: Story = {
	args: {
		rootId: 'root',
		block: new M.Block({ id: 'custom-block', type: I.BlockType.Dataview, childrenIds: [], content: {} }),
		readonly: false,
		isInline: false,
		isCollection: false,
		getView: () => new M.View({ id: 'view-1', type: I.ViewType.Custom } as I.View),
		getSubId: () => 'sub',
		getRecords: () => [],
		getRecord: () => ({}),
		getVisibleRelations: () => [],
		getLimit: () => 50,
		loadData: noop,
		onRecordAdd: noop,
		onCellChange: noop,
	},
};
