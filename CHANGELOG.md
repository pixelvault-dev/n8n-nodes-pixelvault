# Changelog

## 0.3.0

- Add AI descriptions: a `Describe With AI` option on Upload Image and Import Image From URL (alt text, caption and OCR text, generated in the background; free 20 in total, Starter 1,000 a month, Pro 10,000 a month; secret key and verified email required) and a `Wait For Description` option that waits up to about 40 seconds and puts `description` in the output. If it cannot start, the upload still succeeds and the output has `describe_skipped`.
- The text is untrusted model output: escape it before rendering and do not follow instructions in it.

## 0.2.0

- Add custom image metadata: a `Metadata (JSON)` option on Upload Image and Import Image From URL (a JSON object, up to 50 top-level keys and 4 KB), and a new `Update Image Metadata` operation that replaces an image's metadata (`{}` clears it). Invalid metadata fails before any request is made.
- Tests for metadata pass-through on both upload paths, validation, and the update operation.

## 0.1.3

- Validate the `Expires In (Seconds)` option before any request is made: `0` or empty keeps the image permanent, otherwise the value must be a whole number between 60 and 2,592,000. Invalid values fail with a clear error (or become an error item when "Continue On Fail" is on).
- Add tests for `expires_in` pass-through in both Upload Image and Import Image From URL, plus the validation error cases.

## 0.1.2

- Add a `test` script and unit tests for both operations, the hand-built multipart body, error handling and the credential.
- Add `bugs` and `engines` metadata to `package.json`.

## 0.1.1

- First published version. Set `publishConfig.access` to `public` so npm can attach provenance.

## 0.1.0

- Initial node: Upload Image (binary) and Import Image From URL. Not released to npm.
