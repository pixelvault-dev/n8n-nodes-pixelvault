import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type JsonObject,
	type IHttpRequestOptions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

const IMAGES_URL = 'https://api.pixelvault.dev/v1/images';
const MIN_EXPIRES_IN = 60;
const MAX_EXPIRES_IN = 2_592_000;

interface UploadOptions {
	folder?: string;
	visibility?: 'public' | 'private';
	expiresIn?: number;
}

// Empty or 0 keeps the image permanent; anything else must be a whole number of seconds
// inside the range the API accepts, so bad values fail here instead of after a request.
function parseExpiresIn(value: unknown): { seconds?: number; error?: string } {
	if (value === undefined || value === null || value === '' || value === 0) return {};
	const seconds = Number(value);
	if (!Number.isInteger(seconds) || seconds < MIN_EXPIRES_IN || seconds > MAX_EXPIRES_IN) {
		return {
			error: `Expires In must be 0 (keep the image) or a whole number of seconds between ${MIN_EXPIRES_IN} and ${MAX_EXPIRES_IN}.`,
		};
	}
	return { seconds };
}

function fieldsFromOptions(options: UploadOptions): Record<string, string> {
	const fields: Record<string, string> = {};
	if (options.folder) fields.folder = options.folder;
	if (options.visibility) fields.visibility = options.visibility;
	return fields;
}

// Builds a multipart/form-data body by hand so the node needs no runtime dependencies.
function buildMultipart(
	file: { buffer: Buffer; fileName: string; mimeType: string },
	fields: Record<string, string>,
): { body: Buffer; contentType: string } {
	const boundary = `----n8nPixelVault${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
	const safeName = file.fileName.replace(/["\r\n]/g, '_');
	const parts: Buffer[] = [];
	for (const [name, value] of Object.entries(fields)) {
		parts.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
			),
		);
	}
	parts.push(
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
				`Content-Type: ${file.mimeType}\r\n\r\n`,
		),
		file.buffer,
		Buffer.from(`\r\n--${boundary}--\r\n`),
	);
	return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export class PixelVault implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PixelVault',
		name: 'pixelVault',
		icon: {
			light: 'file:../../icons/pixelvault.svg',
			dark: 'file:../../icons/pixelvault.dark.svg',
		},
		usableAsTool: true,
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Host an image and get a public CDN URL',
		defaults: {
			name: 'PixelVault',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'pixelVaultApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Upload Image',
						value: 'upload',
						description: 'Upload an image from binary data and get a public URL',
						action: 'Upload an image',
					},
					{
						name: 'Import Image From URL',
						value: 'importUrl',
						description: 'Have PixelVault fetch an image from a public URL and host it',
						action: 'Import an image from a URL',
					},
				],
				default: 'upload',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: { show: { operation: ['upload'] } },
				description: 'Name of the binary property that holds the image to upload',
			},
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/image.jpg',
				displayOptions: { show: { operation: ['importUrl'] } },
				description:
					'A public HTTPS URL that returns image bytes. Sources that need authentication should be downloaded in n8n first, then uploaded.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Expires In (Seconds)',
						name: 'expiresIn',
						type: 'number',
						default: 0,
						description:
							'Delete the image automatically after this many seconds (60 to 2,592,000). 0 keeps it.',
					},
					{
						displayName: 'Folder',
						name: 'folder',
						type: 'string',
						default: '',
						description: 'Optional folder name (letters, numbers, hyphens and underscores)',
					},
					{
						displayName: 'Visibility',
						name: 'visibility',
						type: 'options',
						options: [
							{ name: 'Public', value: 'public' },
							{ name: 'Private (Signed URL)', value: 'private' },
						],
						default: 'public',
						description: 'Private images are returned as time-limited signed URLs',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			const options = this.getNodeParameter('options', i, {}) as UploadOptions;
			const { seconds: expiresIn, error: expiresError } = parseExpiresIn(options.expiresIn);
			if (expiresError) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: expiresError }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), expiresError, { itemIndex: i });
			}

			try {
				let requestOptions: IHttpRequestOptions;

				if (operation === 'upload') {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
					const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
					const { body, contentType } = buildMultipart(
						{
							buffer,
							fileName: binaryData.fileName ?? 'image',
							mimeType: binaryData.mimeType || 'application/octet-stream',
						},
						{
							...fieldsFromOptions(options),
							...(expiresIn !== undefined && { expires_in: String(expiresIn) }),
						},
					);
					requestOptions = {
						method: 'POST',
						url: IMAGES_URL,
						headers: { 'Content-Type': contentType },
						body,
					};
				} else if (operation === 'importUrl') {
					const imageUrl = this.getNodeParameter('imageUrl', i) as string;
					const body: IDataObject = { url: imageUrl, ...fieldsFromOptions(options) };
					if (expiresIn !== undefined) body.expires_in = expiresIn;
					requestOptions = { method: 'POST', url: IMAGES_URL, body, json: true };
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
						itemIndex: i,
					});
				}

				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'pixelVaultApi',
					requestOptions,
				)) as IDataObject | string;
				const parsed = (typeof response === 'string' ? JSON.parse(response) : response) as {
					data?: IDataObject;
				};

				returnData.push({
					json: (parsed.data ?? (parsed as IDataObject)) as IDataObject,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
