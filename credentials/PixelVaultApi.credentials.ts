import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PixelVaultApi implements ICredentialType {
	name = 'pixelVaultApi';

	displayName = 'PixelVault API';

	icon: Icon = {
		light: 'file:../icons/pixelvault.svg',
		dark: 'file:../icons/pixelvault.dark.svg',
	};

	documentationUrl = 'https://pixelvault.dev/integrations/n8n/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'A secret project API key from your PixelVault dashboard (starts with pv_live_ or pv_test_)',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials?.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.pixelvault.dev',
			url: '/v1/images',
			method: 'GET',
			qs: { per_page: 1 },
		},
	};
}
