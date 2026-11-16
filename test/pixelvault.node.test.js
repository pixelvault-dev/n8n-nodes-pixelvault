'use strict';

// Tests run against the compiled output (npm run test builds first) with a stubbed
// n8n execution context, so they need no extra dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const { NodeApiError, NodeOperationError } = require('n8n-workflow');
const { createHash } = require('node:crypto');

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

const uploadCtx = (options, extra = {}) =>
	makeContext({
		params: { operation: 'upload', binaryPropertyName: 'data', options },
		response: { data: { url: 'u' } },
		...extra,
	});
const importCtx = (options, extra = {}) =>
	makeContext({
		params: { operation: 'importUrl', imageUrl: 'https://example.com/a.jpg', options },
		response: { data: { url: 'u' } },
		...extra,
	});

for (const seconds of [60, 3600, 2592000]) {
	test(`expires_in ${seconds} is sent by both operations`, async () => {
		const up = uploadCtx({ expiresIn: seconds });
		await run(up);
		assert.match(
			up.calls[0].options.body.toString('latin1'),
			new RegExp(`name="expires_in"\\r\\n\\r\\n${seconds}\\r\\n`),
		);

		const imp = importCtx({ expiresIn: seconds });
		await run(imp);
		assert.strictEqual(imp.calls[0].options.body.expires_in, seconds);
	});
}

for (const empty of [0, '', undefined]) {
	test(`expires_in ${JSON.stringify(empty)} keeps the image permanent`, async () => {
		const up = uploadCtx({ expiresIn: empty });
		await run(up);
		assert.doesNotMatch(up.calls[0].options.body.toString('latin1'), /expires_in/);

		const imp = importCtx({ expiresIn: empty });
		await run(imp);
		assert.ok(!('expires_in' in imp.calls[0].options.body));
	});
}

for (const bad of [30, 59, 2592001, 99999999, -60, 90.5, NaN, 'soon']) {
	for (const [name, make] of [
		['upload', uploadCtx],
		['import', importCtx],
	]) {
		test(`${name} rejects expiresIn ${bad} before any request`, async () => {
			const ctx = make({ expiresIn: bad });
			await assert.rejects(
				run(ctx),
				(err) =>
					err instanceof NodeOperationError &&
					/Expires In must be 0.*between 60 and 2592000/.test(err.message),
			);
			assert.equal(ctx.calls.length, 0, 'no HTTP request was made');
		});
	}
}

test('an invalid expiresIn with continue on fail returns an error item', async () => {
	const ctx = importCtx({ expiresIn: 30 }, { continueOnFail: true });
	const [[item]] = await run(ctx);
	assert.match(item.json.error, /Expires In must be 0/);
	assert.equal(ctx.calls.length, 0);
});

test('upload sends metadata as a JSON string field (object or string input)', async () => {
	for (const metadata of [{ env: 'prod', n: 3 }, '{"env":"prod","n":3}']) {
		const ctx = makeContext({
			params: { operation: 'upload', binaryPropertyName: 'data', options: { metadata } },
			response: { data: { url: 'u' } },
		});
		await run(ctx);
		const body = ctx.calls[0].options.body.toString('latin1');
		assert.match(body, /name="metadata"\r\n\r\n\{"env":"prod","n":3\}\r\n/);
	}
});

test('upload omits metadata when empty', async () => {
	for (const metadata of [undefined, '', '{}']) {
		const ctx = makeContext({
			params: { operation: 'upload', binaryPropertyName: 'data', options: { metadata } },
			response: { data: { url: 'u' } },
		});
		await run(ctx);
		assert.doesNotMatch(ctx.calls[0].options.body.toString('latin1'), /name="metadata"/);
	}
});

test('import sends metadata in the JSON body', async () => {
	const ctx = makeContext({
		params: { operation: 'importUrl', imageUrl: 'https://example.com/a.png', options: { metadata: '{"run":"42"}' } },
		response: { data: { url: 'u' } },
	});
	await run(ctx);
	assert.deepEqual(ctx.calls[0].options.body.metadata, { run: '42' });
});

test('invalid metadata fails before any request (or becomes an error item)', async () => {
	for (const metadata of ['not json', '[1]', '"str"']) {
		const ctx = makeContext({
			params: { operation: 'upload', binaryPropertyName: 'data', options: { metadata } },
			response: { data: {} },
		});
		await assert.rejects(run(ctx), NodeOperationError);
		assert.equal(ctx.calls.length, 0);
	}
	const ctx = makeContext({
		params: { operation: 'importUrl', imageUrl: 'https://example.com/a.png', options: { metadata: 'nope' } },
		continueOnFail: true,
	});
	const [[item]] = await run(ctx);
	assert.match(item.json.error, /Metadata must be/);
	assert.equal(ctx.calls.length, 0);
});

test('update metadata PATCHes the image with the object, {} to clear', async () => {
	const ctx = makeContext({
		params: { operation: 'updateMetadata', imageId: 'img_1', metadata: '{"a":1}' },
		response: { data: { id: 'img_1', metadata: { a: 1 } } },
	});
	const [[item]] = await run(ctx);
	const { options } = ctx.calls[0];
	assert.equal(options.method, 'PATCH');
	assert.equal(options.url, 'https://api.pixelvault.dev/v1/images/img_1');
	assert.deepEqual(options.body, { metadata: { a: 1 } });
	assert.deepEqual(item.json.metadata, { a: 1 });

	const clear = makeContext({
		params: { operation: 'updateMetadata', imageId: 'img_1', metadata: '{}' },
		response: { data: { id: 'img_1', metadata: null } },
	});
	await run(clear);
	assert.deepEqual(clear.calls[0].options.body, { metadata: {} });
});

test('describe sends describe=true on upload (multipart) and import (JSON), only when set', async () => {
	const up = makeContext({
		params: { operation: 'upload', binaryPropertyName: 'data', options: { describe: true } },
		response: { data: { id: 'img_1', description: { status: 'pending' } } },
	});
	const [[upItem]] = await run(up);
	assert.match(up.calls[0].options.body.toString('latin1'), /name="describe"\r\n\r\ntrue\r\n/);
	assert.deepEqual(upItem.json.description, { status: 'pending' }, 'no wait: returns the pending description');
	assert.equal(up.calls.length, 1, 'no polling without Wait For Description');

	const off = makeContext({
		params: { operation: 'upload', binaryPropertyName: 'data', options: {} },
		response: { data: { id: 'img_1' } },
	});
	await run(off);
	assert.doesNotMatch(off.calls[0].options.body.toString('latin1'), /name="describe"/);

	const imp = makeContext({
		params: { operation: 'importUrl', imageUrl: 'https://example.com/a.png', options: { describe: true } },
		response: { data: { id: 'img_2', description: { status: 'pending' } } },
	});
	await run(imp);
	assert.equal(imp.calls[0].options.body.describe, true);
});

test('wait for description polls the image until it is done and puts it in the output', async () => {
	const ctx = makeContext({
		params: {
			operation: 'upload',
			binaryPropertyName: 'data',
			options: { describe: true, waitForDescription: true },
		},
		response: { data: { id: 'img_1', description: { status: 'pending' } } },
	});
	// First call is the upload; later calls are the GET polls.
	let n = 0;
	ctx.helpers.httpRequestWithAuthentication = async function (credentialName, options) {
		ctx.calls.push({ credentialName, options });
		n++;
		if (n === 1) return { data: { id: 'img_1', description: { status: 'pending' } } };
		return { data: { id: 'img_1', description: { status: 'done', alt: 'A red square', caption: 'c', ocr_text: '' } } };
	};
	const [[item]] = await run(ctx);
	assert.equal(ctx.calls.length, 2);
	assert.equal(ctx.calls[1].options.method, 'GET');
	assert.equal(ctx.calls[1].options.url, 'https://api.pixelvault.dev/v1/images/img_1');
	assert.equal(item.json.description.status, 'done');
	assert.equal(item.json.description.alt, 'A red square');
});

test('wait for description does not poll when the description was skipped or already done', async () => {
	for (const data of [
		{ id: 'img_1', description: null, describe_skipped: 'quota' },
		{ id: 'img_1', description: { status: 'done', alt: 'x', cached: true } },
	]) {
		const ctx = makeContext({
			params: { operation: 'upload', binaryPropertyName: 'data', options: { describe: true, waitForDescription: true } },
			response: { data },
		});
		const [[item]] = await run(ctx);
		assert.equal(ctx.calls.length, 1);
		assert.equal(item.json.describe_skipped, data.describe_skipped);
	}
});

test('video upload sends raw MP4 headers, lifecycle fields, and a replay checksum', async () => {
	const ctx = makeContext({
		params: {
			operation: 'uploadVideo',
			binaryPropertyName: 'data',
			options: {
				visibility: 'private',
				expiresIn: 3600,
				folder: 'demos',
				collectionId: 'col_1',
				metadata: { env: 'test' },
				socialReady: true,
				signExpiresIn: 300,
				idempotencyKey: 'retry-1',
			},
		},
		response: { data: { id: 'vid_1', kind: 'video' } },
	});
	const [[item]] = await run(ctx);
	const request = ctx.calls[0].options;
	assert.equal(item.json.id, 'vid_1');
	assert.equal(request.url, 'https://api.pixelvault.dev/v1/videos');
	assert.equal(request.headers['Content-Type'], 'video/mp4');
	assert.equal(request.headers['Content-Length'], String(PNG.length));
	assert.equal(request.headers['X-PixelVault-Filename'], 'pixel.png');
	assert.equal(request.headers['X-PixelVault-Visibility'], 'private');
	assert.equal(request.headers['X-PixelVault-Expires-In'], '3600');
	assert.equal(request.headers['X-PixelVault-Folder'], 'demos');
	assert.equal(request.headers['X-PixelVault-Collection-Id'], 'col_1');
	assert.equal(request.headers['X-PixelVault-Social-Ready'], 'true');
	assert.equal(request.headers['X-PixelVault-Sign-Expires-In'], '300');
	assert.equal(request.headers['Idempotency-Key'], 'retry-1');
	assert.equal(request.headers['X-PixelVault-Content-SHA256'], createHash('sha256').update(PNG).digest('hex'));
	assert.deepEqual(JSON.parse(request.headers['X-PixelVault-Metadata']), { env: 'test' });
	assert.deepEqual(request.body, PNG);
});

test('video import passes secure import and lifecycle fields as JSON', async () => {
	const ctx = makeContext({
		params: {
			operation: 'importVideo',
			videoUrl: 'https://example.com/demo.mp4',
			options: {
				visibility: 'private',
				expiresIn: 3600,
				folder: 'demos',
				collectionId: 'col_1',
				metadata: { source: 'test' },
				socialReady: true,
				signExpiresIn: 300,
				idempotencyKey: 'import-1',
			},
		},
		response: { data: { id: 'vid_1' } },
	});
	await run(ctx);
	const request = ctx.calls[0].options;
	assert.equal(request.headers['Idempotency-Key'], 'import-1');
	assert.deepEqual(request.body, {
		url: 'https://example.com/demo.mp4',
		visibility: 'private',
		expires_in: 3600,
		folder: 'demos',
		collection_id: 'col_1',
		metadata: { source: 'test' },
		social_ready: true,
		sign_expires_in: 300,
	});
});

test('video enrichment returns job IDs immediately and can resume with Get Video', async () => {
	const pending = {
		id: 'vid_1',
		enrichment: { job_id: 'ven_1', status: 'pending' },
		social_optimization: { status: 'not_requested' },
	};
	const enrich = makeContext({
		params: { operation: 'enrichVideo', videoId: 'vid_1', options: {} },
		response: { data: pending },
	});
	const [[queued]] = await run(enrich);
	assert.equal(enrich.calls.length, 1);
	assert.equal(enrich.calls[0].options.url, 'https://api.pixelvault.dev/v1/videos/vid_1/enrich');
	assert.equal(queued.json.enrichment.job_id, 'ven_1');

	const resume = makeContext({
		params: { operation: 'getVideo', videoId: 'vid_1' },
		response: { data: { ...pending, enrichment: { job_id: 'ven_1', status: 'complete', transcript: {} } } },
	});
	const [[completed]] = await run(resume);
	assert.equal(resume.calls[0].options.method, 'GET');
	assert.equal(completed.json.enrichment.status, 'complete');
});

test('video job wait polls with a local bound and does not imply cancellation', async () => {
	const ctx = makeContext({
		params: {
			operation: 'optimizeVideo',
			videoId: 'vid_1',
			options: { waitForCompletion: true, waitTimeoutSeconds: 0.01 },
		},
		response: {},
	});
	let call = 0;
	ctx.helpers.httpRequestWithAuthentication = async function (credentialName, options) {
		ctx.calls.push({ credentialName, options });
		call++;
		if (call === 1) {
			return {
				data: {
					id: 'vid_1',
					social_optimization: { job_id: 'vop_1', status: 'processing' },
				},
			};
		}
		return {
			data: {
				id: 'vid_1',
				social_optimization: { job_id: 'vop_1', status: 'complete' },
			},
		};
	};
	const [[item]] = await run(ctx);
	assert.equal(ctx.calls.length, 2);
	assert.equal(ctx.calls[1].options.url, 'https://api.pixelvault.dev/v1/videos/vid_1');
	assert.equal(item.json.social_optimization.status, 'complete');

	const timeout = makeContext({
		params: {
			operation: 'enrichVideo',
			videoId: 'vid_1',
			options: { waitForCompletion: true, waitTimeoutSeconds: 0 },
		},
		response: { data: { id: 'vid_1', enrichment: { job_id: 'ven_1', status: 'pending' } } },
	});
	const [[timedOut]] = await run(timeout);
	assert.equal(timeout.calls.length, 1);
	assert.equal(timedOut.json.wait_timed_out, true);
	assert.equal(timedOut.json.enrichment.status, 'pending');
});

test('video list, update, signing, and deletion use the REST contract', async () => {
	const list = makeContext({
		params: {
			operation: 'listVideos',
			options: { page: 2, perPage: 5, folder: 'demos', collectionId: 'col_1', metadata: { env: 'test' } },
		},
		response: { data: [{ id: 'vid_1' }], meta: { total: 1, page: 2, per_page: 5 } },
	});
	const [[listed]] = await run(list);
	assert.deepEqual(list.calls[0].options.qs, {
		page: 2,
		per_page: 5,
		folder: 'demos',
		collection_id: 'col_1',
		metadata: '{\"env\":\"test\"}',
	});
	assert.equal(listed.json.videos[0].id, 'vid_1');

	const update = makeContext({
		params: {
			operation: 'updateVideo',
			videoId: 'vid_1',
			metadata: { env: 'prod' },
			options: { folder: '', collectionId: '' },
		},
		response: { data: { id: 'vid_1', folder: null, collection_id: null, metadata: { env: 'prod' } } },
	});
	await run(update);
	assert.deepEqual(update.calls[0].options.body, {
		metadata: { env: 'prod' },
		folder: null,
		collection_id: null,
	});

	const sign = makeContext({
		params: { operation: 'signVideo', videoId: 'vid_1', options: { signExpiresIn: 300 } },
		response: { data: { url: 'https://signed.example/video.mp4', expires: 123, enrichment: {} } },
	});
	const [[signed]] = await run(sign);
	assert.deepEqual(sign.calls[0].options.body, { expires_in: 300 });
	assert.equal(signed.json.url, 'https://signed.example/video.mp4');

	const remove = makeContext({
		params: { operation: 'deleteVideo', videoId: 'vid_1' },
		response: { success: true },
	});
	const [[deleted]] = await run(remove);
	assert.equal(remove.calls[0].options.method, 'DELETE');
	assert.equal(deleted.json.success, true);
});
