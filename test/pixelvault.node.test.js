'use strict';

// Tests run against the compiled output (npm run test builds first) with a stubbed
// n8n execution context, so they need no extra dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const { NodeApiError } = require('n8n-workflow');

const { PixelVault } = require('../dist/nodes/PixelVault/PixelVault.node.js');
const { PixelVaultApi } = require('../dist/credentials/PixelVaultApi.credentials.js');

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

function makeContext({ params = {}, items = [{ json: {} }], response, fail, continueOnFail = false }) {
	const calls = [];
	const ctx = {
		calls,
		getInputData: () => items,
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({ name: 'PixelVault', type: 'n8n-nodes-pixelvault.pixelVault' }),
		continueOnFail: () => continueOnFail,
		helpers: {
			assertBinaryData: () => ({ fileName: 'pixel.png', mimeType: 'image/png' }),
			getBinaryDataBuffer: async () => PNG,
			httpRequestWithAuthentication: async function (credentialName, options) {
				calls.push({ credentialName, options });
				if (fail) throw fail;
				return response;
			},
		},
	};
	return ctx;
}

const run = (ctx) => new PixelVault().execute.call(ctx);

test('upload sends a multipart body with the file and option fields', async () => {
	const ctx = makeContext({
		params: {
			operation: 'upload',
			binaryPropertyName: 'data',
			options: { folder: 'n8n', visibility: 'private', expiresIn: 300 },
		},
		response: { data: { id: 'img_1', url: 'https://img.pixelvault.dev/p/img_1.png' } },
	});

	const [[item]] = await run(ctx);

	assert.equal(ctx.calls.length, 1);
	const { credentialName, options } = ctx.calls[0];
	assert.equal(credentialName, 'pixelVaultApi');
	assert.equal(options.method, 'POST');
	assert.equal(options.url, 'https://api.pixelvault.dev/v1/images');

	const contentType = options.headers['Content-Type'];
	const boundary = /^multipart\/form-data; boundary=(.+)$/.exec(contentType)?.[1];
	assert.ok(boundary, 'Content-Type carries a boundary');

	const body = options.body.toString('latin1');
	assert.ok(body.startsWith(`--${boundary}\r\n`));
	assert.ok(body.endsWith(`--${boundary}--\r\n`));
	assert.match(body, /name="folder"\r\n\r\nn8n\r\n/);
	assert.match(body, /name="visibility"\r\n\r\nprivate\r\n/);
	assert.match(body, /name="expires_in"\r\n\r\n300\r\n/);
	assert.match(body, /name="file"; filename="pixel\.png"\r\nContent-Type: image\/png\r\n\r\n/);
	assert.ok(options.body.includes(PNG), 'file bytes are present unchanged');

	// The API wraps the image in `data`; the node flattens it so {{ $json.url }} works.
	assert.equal(item.json.url, 'https://img.pixelvault.dev/p/img_1.png');
	assert.deepEqual(item.pairedItem, { item: 0 });
});

test('upload omits option fields that were not set', async () => {
	const ctx = makeContext({
		params: { operation: 'upload', binaryPropertyName: 'data', options: {} },
		response: { data: { url: 'u' } },
	});
	await run(ctx);
	const body = ctx.calls[0].options.body.toString('latin1');
	assert.doesNotMatch(body, /name="folder"/);
	assert.doesNotMatch(body, /name="visibility"/);
	assert.doesNotMatch(body, /name="expires_in"/);
});

test('upload strips quotes and newlines from the filename', async () => {
	const ctx = makeContext({ params: { operation: 'upload', binaryPropertyName: 'data', options: {} }, response: { data: {} } });
	ctx.helpers.assertBinaryData = () => ({ fileName: 'a"b\r\nc.png', mimeType: 'image/png' });
	await run(ctx);
	const body = ctx.calls[0].options.body.toString('latin1');
	assert.match(body, /filename="a_b__c\.png"/);
});

test('import sends JSON with url and option fields', async () => {
	const ctx = makeContext({
		params: {
			operation: 'importUrl',
			imageUrl: 'https://example.com/image.jpg',
			options: { folder: 'make', expiresIn: 60 },
		},
		response: { data: { id: 'img_2', url: 'https://img.pixelvault.dev/p/img_2.jpg' } },
	});

	const [[item]] = await run(ctx);

	const { options } = ctx.calls[0];
	assert.equal(options.method, 'POST');
	assert.equal(options.json, true);
	assert.equal(options.body.url, 'https://example.com/image.jpg');
	assert.equal(options.body.folder, 'make');
	assert.equal(options.body.expires_in, 60);
	assert.equal(item.json.id, 'img_2');
});

test('processes every input item and pairs the outputs', async () => {
	const ctx = makeContext({
		items: [{ json: {} }, { json: {} }],
		params: { operation: 'importUrl', imageUrl: 'https://example.com/a.jpg', options: {} },
		response: { data: { url: 'u' } },
	});
	const [out] = await run(ctx);
	assert.equal(out.length, 2);
	assert.deepEqual(out.map((o) => o.pairedItem.item), [0, 1]);
	assert.equal(ctx.calls.length, 2);
});

test('API errors are raised as NodeApiError', async () => {
	const ctx = makeContext({
		params: { operation: 'importUrl', imageUrl: 'https://example.com/a.jpg', options: {} },
		fail: Object.assign(new Error('Unauthorized'), { httpCode: '401' }),
	});
	await assert.rejects(run(ctx), (err) => err instanceof NodeApiError);
});

test('continue on fail returns an error item instead of throwing', async () => {
	const ctx = makeContext({
		params: { operation: 'importUrl', imageUrl: 'https://example.com/a.jpg', options: {} },
		fail: new Error('boom'),
		continueOnFail: true,
	});
	const [[item]] = await run(ctx);
	assert.equal(item.json.error, 'boom');
	assert.deepEqual(item.pairedItem, { item: 0 });
});

test('credential sends the key as a Bearer header and tests against the API', () => {
	const cred = new PixelVaultApi();
	assert.equal(cred.name, 'pixelVaultApi');
	assert.equal(cred.authenticate.properties.headers.Authorization, '=Bearer {{$credentials?.apiKey}}');
	assert.equal(cred.test.request.baseURL, 'https://api.pixelvault.dev');
	assert.equal(cred.test.request.url, '/v1/images');
	assert.equal(cred.properties[0].typeOptions.password, true);
});

test('package metadata registers the node and credential', () => {
	const pkg = require('../package.json');
	assert.deepEqual(pkg.n8n.nodes, ['dist/nodes/PixelVault/PixelVault.node.js']);
	assert.deepEqual(pkg.n8n.credentials, ['dist/credentials/PixelVaultApi.credentials.js']);
	assert.equal(pkg.license, 'MIT');
	assert.equal(pkg.publishConfig.access, 'public');
	assert.equal(pkg.dependencies, undefined, 'verified nodes cannot have runtime dependencies');
});
