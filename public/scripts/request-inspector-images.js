/**
 * Pure helpers for the Request Inspector's image parts.
 *
 * Split out of `request-inspector.js` so the wire-shape → descriptor and
 * descriptor → HTML mappings can be unit-tested under the node test
 * environment (same approach as `request-inspector-reasoning.js` /
 * `request-inspector-tools.js`). DOM-free: escaping is a plain string
 * operation.
 *
 * Every provider dialect Luker touches encodes images differently:
 *   - OpenAI chat:    content part `{type:'image_url', image_url:{url:'data:…'}}`
 *   - OpenAI Responses: `{type:'input_image', image_url:'data:…' | {url}}`
 *   - Claude:         content part `{type:'image', source:{type:'base64', media_type, data}}`
 *   - Gemini:         contents part `{inlineData:{mimeType, data}}` or
 *                     `{fileData:{fileUri, mimeType}}`
 */

const DATA_URL_RE = /^data:([^;,]+)?(?:;[^;,]*)*;base64,([\s\S]+)$/;
// Below this length a string is never an inline media payload: even a 1 KB
// image is ~1.4 K base64 chars, while ids / hashes / tokens are shorter and
// carry non-base64 punctuation. Only long blobs get elided from wire dumps.
const ELIDE_MIN_BASE64_CHARS = 4096;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatBytes(n) {
    if (n == null) return '\u2014';
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/** base64 payload length → decoded byte size (4 chars encode 3 bytes). */
function base64ByteSize(b64) {
    return Math.floor((b64.length || 0) * 3 / 4);
}

/**
 * Map one content part onto a renderable image descriptor, or null when the
 * part carries no image. `src` is a data URL or a remote URL; `sizeBytes` is
 * the decoded size for inline base64, null for remote URLs.
 *
 * @param {*} part
 * @returns {{ src: string, mime: string, sizeBytes: number|null }|null}
 */
export function imageFromPart(part) {
    if (!part || typeof part !== 'object') return null;

    // OpenAI chat / Responses shapes.
    if (part.type === 'image_url' || part.type === 'input_image') {
        const url = typeof part.image_url === 'string' ? part.image_url : (part.image_url?.url || '');
        if (!url) return null;
        const m = url.match(DATA_URL_RE);
        if (m) return { src: url, mime: m[1] || '', sizeBytes: base64ByteSize(m[2]) };
        return { src: url, mime: '', sizeBytes: null };
    }

    // Claude shape: base64 data or a remote URL behind `source`.
    if (part.type === 'image' && part.source) {
        const source = part.source;
        if (typeof source.data === 'string' && source.data) {
            const mime = source.media_type || source.type || '';
            return { src: `data:${mime};base64,${source.data}`, mime, sizeBytes: base64ByteSize(source.data) };
        }
        if (typeof source.url === 'string' && source.url) {
            return { src: source.url, mime: source.media_type || '', sizeBytes: null };
        }
        return null;
    }

    // Gemini shapes: inline bytes or a provider-side file reference.
    if (part.inlineData && typeof part.inlineData.data === 'string') {
        const mime = part.inlineData.mimeType || '';
        return { src: `data:${mime};base64,${part.inlineData.data}`, mime, sizeBytes: base64ByteSize(part.inlineData.data) };
    }
    if (part.fileData && typeof part.fileData.fileUri === 'string') {
        return { src: part.fileData.fileUri, mime: part.fileData.mimeType || '', sizeBytes: null };
    }

    return null;
}

/**
 * Server-normalized response image part (`{type:'image', mime, data}` as
 * emitted by the backend extractors) → descriptor.
 *
 * @param {*} part
 * @returns {{ src: string, mime: string, sizeBytes: number|null }|null}
 */
export function responsePartToImage(part) {
    if (!part || part.type !== 'image') return null;
    if (typeof part.data === 'string' && part.data) {
        const mime = part.mime || '';
        return { src: `data:${mime};base64,${part.data}`, mime, sizeBytes: base64ByteSize(part.data) };
    }
    if (typeof part.src === 'string' && part.src) {
        return { src: part.src, mime: part.mime || '', sizeBytes: part.sizeBytes ?? null };
    }
    return null;
}

/**
 * Every image descriptor inside a message's `content`, in order. Recurses
 * into plain arrays and tool_result content so nested payloads are covered.
 *
 * @param {*} content
 * @returns {{ src: string, mime: string, sizeBytes: number|null }[]}
 */
export function extractMessageImages(content) {
    const images = [];
    const walk = (value) => {
        if (!Array.isArray(value)) return;
        for (const part of value) {
            if (typeof part === 'string' || part == null) continue;
            const image = imageFromPart(part);
            if (image) { images.push(image); continue; }
            if (part.type === 'tool_result') walk(part.content);
        }
    };
    walk(content);
    return images;
}

/**
 * Placeholder text for the message content pre — keeps the text rendering of
 * an image part compact (no base64 dump) while still surfacing mime and
 * size, the two facts needed to reason about request weight.
 *
 * @param {*} part
 * @returns {string} `[image: …]` marker, or '' when the part is not an image
 */
export function describeImagePart(part) {
    const image = imageFromPart(part);
    if (!image) return '';
    const size = image.sizeBytes != null ? `, ${formatBytes(image.sizeBytes)}` : '';
    if (image.mime) return `[image: ${image.mime}${size}]`;
    if (image.sizeBytes != null) return `[image${size}]`;
    const url = image.src || '';
    if (url) return `[image: ${url.slice(0, 80)}${url.length > 80 ? '\u2026' : ''}]`;
    return '[image]';
}

/**
 * `<img>` markup for an image descriptor. `loading="lazy"` keeps offscreen
 * previews from decoding until they are visible.
 *
 * @param {{ src: string, mime: string, sizeBytes: number|null }} image
 * @returns {string}
 */
export function imageToHtml(image) {
    if (!image?.src) return '';
    const title = image.sizeBytes != null ? `${image.mime || 'image'}, ${formatBytes(image.sizeBytes)}` : (image.mime || 'image');
    return `<img class="ri-img" src="${escapeHtml(image.src)}" alt="${escapeHtml(title)}" title="${escapeHtml(title)}" loading="lazy">`;
}

/**
 * JSON.stringify with inline media payloads elided. Data URLs and long
 * base64 blobs become short `[elided …]` markers so wire dumps stay
 * readable and the DOM stays cheap; the full bytes remain available in the
 * image previews and the export endpoint.
 *
 * @param {*} value
 * @returns {string} pretty-printed JSON, or String(value) when it cannot be serialized
 */
export function elideBase64Json(value) {
    try {
        return JSON.stringify(value, (key, entry) => {
            if (typeof entry !== 'string') return entry;
            const m = entry.match(DATA_URL_RE);
            if (m && m[2].length >= ELIDE_MIN_BASE64_CHARS) {
                return `[elided image: ${m[1] || 'data'}, ${formatBytes(base64ByteSize(m[2]))}]`;
            }
            if (entry.length >= ELIDE_MIN_BASE64_CHARS && BASE64_RE.test(entry)) {
                return `[elided base64, ${formatBytes(base64ByteSize(entry))}]`;
            }
            return entry;
        }, 2);
    } catch {
        return String(value);
    }
}
