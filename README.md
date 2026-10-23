# n8n-nodes-pixelvault

An [n8n](https://n8n.io/) community node for [PixelVault](https://pixelvault.dev), an image host built for automations and AI agents. Pass it an image and it returns a public CDN URL you can use in the next step, for example an Instagram, Notion, Slack or email node.

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

Both operations accept these options:

- **Folder**: group images under a folder name (letters, numbers, hyphens and underscores).
- **Visibility**: `Public` or `Private (Signed URL)`. Private images are returned as time-limited signed URLs.
- **Expires In (Seconds)**: delete the image automatically after this long.

The output is the image object returned by the PixelVault API, with fields such as `url`, `id`, `mime_type`, `size` and `filename`. Map the hosted link with `{{ $json.url }}`.

## Credentials

Create a project API key in your [PixelVault dashboard](https://pixelvault.dev/dashboard/) and use a **secret** key (it starts with `pv_live_` or `pv_test_`). Publishable keys (`pv_pub_`) are rejected for URL import.

In n8n, add a **PixelVault API** credential and paste the key. The credential's test request lists one image to confirm the key works. The key is sent as `Authorization: Bearer <key>`.

Uploads made without a key expire. Use the credential for images you want to keep.

## Usage

Typical flow: **Google Drive: Download** (or any node that outputs an image as binary) → **PixelVault: Upload Image** → your publishing node, mapping `{{ $json.url }}`.

- The binary field name defaults to `data`. Change **Input Binary Field** if your source node uses another name.
- Hosted images are public unless you choose Private. Use images intended for publication.
- For Instagram, start with a JPEG that meets Meta's size and aspect-ratio requirements. Hosting does not convert or validate images for a destination.
- Supported formats and size limits are those of the PixelVault API (currently JPG, PNG, GIF, WebP, AVIF and SVG, up to 5 MB per file on the free plan).
- This node hosts images. It does not host video.

A ready-made workflow and notes for Google Drive and Instagram are at <https://pixelvault.dev/integrations/n8n/>.

## Compatibility

Requires an n8n version with community node support. The node uses only n8n's built-in HTTP helper and has no runtime dependencies.

## Resources

- [PixelVault](https://pixelvault.dev)
- [API documentation](https://pixelvault.dev/docs/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE)
