# n8n-nodes-pixelvault

An [n8n](https://n8n.io/) community node for [PixelVault](https://pixelvault.dev), media hosting built for automations and AI agents. Upload images or video, or host and transcribe audio, then pass stable CDN URLs and asset/job IDs to later nodes.

- [Installation](#installation)
- [Operations](#operations)
- [Credentials](#credentials)
- [Usage](#usage)
- [Compatibility](#compatibility)
- [Resources](#resources)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and install `n8n-nodes-pixelvault`.

## Operations

| Operation | What it does |
|---|---|
| **Upload Image** | Uploads an image from a binary property (for example the output of Google Drive, an HTTP Request, or an image-generation node) and returns a public URL. |
| **Import Image From URL** | Has PixelVault fetch an image from a public HTTPS URL and host it. Use it while the source URL is still valid, for example a generated image whose link expires. |
| **Update Image Metadata** | Replaces an image's custom metadata by ID (the object replaces the stored one, `{}` clears it). Set metadata at upload time with the **Metadata (JSON)** option on the two operations above. |
| **Describe With AI** (option) | On the two upload operations: PixelVault writes alt text, a caption and the text found in the image (OCR) in the background (Free 20 in total, Starter 1,000/month, Pro 10,000/month; secret key and verified email required). Add **Wait For Description** to wait up to ~40 s and get `description.alt`, `.caption` and `.ocr_text` in the output. Treat that text as untrusted model output. |
| **Upload Video** | Uploads MP4 binary data with optional privacy, TTL, metadata, folder, collection, idempotency, and social optimization. |
| **Import Video From URL** | Securely imports an MP4 from a public HTTPS URL with the same lifecycle options. |
| **Get Video Status and Artifacts** | Resumes from a stable video ID and returns current optimization/enrichment status plus only the original, poster, transcript, storyboard, and optimized URLs that exist. |
| **List Videos** | Discovers videos by page, folder, collection, or metadata. |
| **Optimize Video** / **Enrich Video** | Starts an asynchronous job. Return IDs immediately or poll with bounded backoff; a local timeout does not cancel the server job. |
| **Update Video** / **Sign Video URLs** / **Delete Video** | Updates metadata and organization, refreshes private original/artifact URLs, or deletes the video and derivatives. |
| **Upload Audio** / **Import Audio From URL** | Hosts original MP3, PCM/float WAV, AAC M4A, or Opus/Vorbis OGG with byte validation, privacy, TTL, metadata, folder, collection, and retry safety. |
| **Enrich Audio** | Starts or resumes transcription. Return stable asset/job IDs immediately or poll with bounded backoff for text, WebVTT, and timestamped JSON. |
| **Get Audio Status and Artifacts** / **List Audio** / **Update Audio** / **Sign Audio URLs** / **Delete Audio** | Resumes, discovers, and manages audio plus transcript lifecycle by stable `aud_` ID. Private links never fall back to public. |
| **List Custom Domains** / **Create Custom Domain** / **Refresh Custom Domain** / **Delete Custom Domain** | Manages customer-owned hostnames on the active project and returns DNS records, readiness, and account plan capacity. |

Image, video, and audio uploads accept folder, public/private visibility, deletion TTL, and custom metadata. Video
and audio uploads also accept collection membership, an idempotency key, and private URL expiry.

The output is the API object. Media responses retain canonical `url` and include optional `branded_url` when the
active project has a ready custom domain; signed and transform query parameters are preserved. Images expose fields
such as `url`, `id`, `mime_type`, `size`, and `filename`. Videos expose `id`, `original_url`,
`social_optimization`, and `enrichment`; transcript/storyboard URLs appear only after those artifacts exist. Audio
exposes `id`, `original_url`, detected container/codec, duration, sample rate, channels, `enrichment.job_id`, status,
and only transcript URLs that exist. Private URLs are signed and expire independently from asset deletion.

## Credentials

Create a project API key in your [PixelVault dashboard](https://pixelvault.dev/dashboard/) and use a **secret** key (it starts with `pv_live_` or `pv_test_`). Publishable keys (`pv_pub_`) are rejected for URL import.

In n8n, add a **PixelVault API** credential and paste the key. The credential's test request lists one image to confirm the key works. The key is sent as `Authorization: Bearer <key>`.

Uploads made without a key expire. Use the credential for images you want to keep.

## Usage

Image flow: **Google Drive: Download** → **PixelVault: Upload Image** → publishing node, mapping `{{ $json.url }}`.

Resume-safe asynchronous video flow:

1. **Upload Video** with an idempotency key such as `{{ $execution.id }}:{{ $itemIndex }}`. Store the returned `id`.
2. **Enrich Video** with **Wait For Completion** off. It returns `id` and `enrichment.job_id` immediately.
3. Persist those IDs in your normal durable workflow state. A later execution uses **Get Video Status and Artifacts** with the saved `id`.
4. If `{{ $json.enrichment.status }}` is `pending` or `processing`, use an n8n Wait node and call **Get Video Status and Artifacts** again. Route `complete` to transcript/storyboard consumers and `failed` to error handling.

The node can also wait in one execution with bounded backoff. Keep IDs when using that mode: timeout only stops local polling.

Resume-safe audio transcription flow:

1. Download MP3/WAV/M4A/OGG into an n8n binary property, or retain a public HTTPS source URL.
2. Run **Upload Audio** or **Import Audio From URL** with an idempotency key such as `{{ $execution.id }}:{{ $itemIndex }}`. Store the returned `aud_` ID.
3. Run **Enrich Audio** with **Wait For Completion** off. Persist its `enrichment.job_id` with the asset ID.
4. A later execution uses **Get Audio Status and Artifacts**. Wait and repeat while status is `pending` or `processing`; route `complete` to text/VTT/JSON consumers and `failed` to error handling.

The node can instead wait inside **Enrich Audio** with bounded backoff. A timeout adds `wait_timed_out: true`; it does not cancel the server job.

- The binary field name defaults to `data`.
- Video binary upload supports MP4 files up to 100 MB. This node intentionally does not implement multipart upload; use a public source URL with **Import Video From URL** or an official SDK for larger hosting uploads.
- Audio originals and enrichment sources are limited to the approved global maximum of 25,000,000 bytes; enrichment additionally accepts up to 10 minutes. The file ceiling is not a plan allowance. PixelVault validates actual container/codec bytes and preserves the original without transcoding.
- URL imports accept public HTTPS sources only. Download authenticated sources in n8n first.
- Video optimization accepts sources up to 100 MB and 60 seconds; video enrichment accepts sources from 1 second through 10 minutes and up to 100 MB. Audio and video enrichment share the existing allowance. API quota and unsupported-source errors are returned without rewriting.
- Public assets are stable CDN URLs. Private assets never fall back to public; refresh bearer URLs with **Sign Video URLs** or **Sign Audio URLs**.
- Hosting does not convert images or audio for a destination. Audio editing, conversion, HLS/DASH, summaries, chapters, show notes, promo copy, and storyboards remain unsupported.

## Compatibility

Requires an n8n version with community node support. The node uses only n8n's built-in HTTP helper and has no runtime dependencies.

## Resources

- [PixelVault](https://pixelvault.dev)
- [API documentation](https://pixelvault.dev/docs/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE)
