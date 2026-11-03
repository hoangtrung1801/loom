import React from 'react';
import * as mobx from 'mobx';
import type { LoomApi, PluginManifest, SearchParam } from './types';

/**
 * Builds the object handed to a plugin as `this.app`. Thin wrappers over the app's own commands and stores.
 */
export const createApi = (manifest: PluginManifest): LoomApi => {
	const getSpaceId = () => S.Common.space;

	return {
		version: String(U.Common.getElectron().version?.app || ''),

		theme: () => (S.Common.getThemeClass() == 'dark' ? 'dark' : 'light'),

		notice: (text: string) => Preview.toastShow({ text: String(text || '') }),

		space: {
			id: () => getSpaceId(),
		},

		objects: {
			search: (param?: SearchParam) => new Promise<any[]>((resolve) => {
				param = param || {};

				U.Subscription.search({
					fullText: String(param.query || ''),
					filters: param.filters || [],
					sorts: param.sorts || [],
					limit: Number(param.limit) || 50,
				}, (message: any) => resolve(message.error?.code ? [] : (message.records || [])));
			}),

			get: (id: string) => {
				const object = S.Detail.get(id, id);

				return object._empty_ ? null : object;
			},

			getById: (id: string) => new Promise<any>((resolve) => {
				let found = false;

				U.Object.getById(id, {}, (object: any) => {
					found = true;
					resolve(object);
				});

				window.setTimeout(() => !found && resolve(null), 5000);
			}),

			open: (id: string) => {
				const object = S.Detail.get(id, id);

				U.Object.openAuto({ id, layout: object.layout });
			},

			update: (id: string, key: string, value: any) => new Promise<void>((resolve, reject) => {
				C.ObjectListSetDetails([ id ], [ { key, value } ], (message: any) => {
					message.error?.code ? reject(new Error(message.error.description)) : resolve();
				});
			}),

			create: (details?: any, typeKey?: string) => new Promise<any>((resolve, reject) => {
				const type = typeKey ? S.Record.getTypeByKey(typeKey) : S.Record.getTypeById(S.Common.type);
				const key = typeKey || type?.uniqueKey || '';

				C.ObjectCreate(details || {}, [], type?.defaultTemplateId || '', key, getSpaceId(), (message: any) => {
					message.error?.code ? reject(new Error(message.error.description)) : resolve(message.details);
				});
			}),
		},

		ui: {
			openPopup: (id: string, param?: any) => S.Popup.open(id, param || {}),

			confirm: (title: string, text: string) => new Promise<boolean>((resolve) => {
				S.Popup.open('confirm', {
					data: {
						title,
						text,
						onConfirm: () => resolve(true),
						onCancel: () => resolve(false),
					},
					onClose: () => resolve(false),
				});
			}),
		},

		React,
		mobx,
	};
};

