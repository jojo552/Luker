// SPDX-License-Identifier: AGPL-3.0-or-later
import {
    imageFromPart,
    responsePartToImage,
    extractMessageImages,
    describeImagePart,
    imageToHtml,
    elideBase64Json,
} from '../public/scripts/request-inspector-images.js';

const B64 = 'A'.repeat(64);

describe('imageFromPart across provider dialects', () => {
    test('OpenAI image_url with data URL', () => {
        const part = { type: 'image_url', image_url: { url: `data:image/png;base64,${B64}` } };
        const image = imageFromPart(part);
        expect(image.src).toBe(`data:image/png;base64,${B64}`);
        expect(image.mime).toBe('image/png');
        expect(image.sizeBytes).toBe(48); // 64 chars → 48 decoded bytes
    });

    test('OpenAI image_url with remote URL', () => {
        const part = { type: 'image_url', image_url: { url: 'https://cdn.example.test/cat.png' } };
        const image = imageFromPart(part);
        expect(image.src).toBe('https://cdn.example.test/cat.png');
        expect(image.sizeBytes).toBeNull();
    });

    test('OpenAI Responses input_image with string data URL', () => {
        const part = { type: 'input_image', image_url: `data:image/jpeg;base64,${B64}` };
        const image = imageFromPart(part);
        expect(image.mime).toBe('image/jpeg');
        expect(image.src).toBe(`data:image/jpeg;base64,${B64}`);
    });

    test('Claude image with base64 source', () => {
        const part = { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: B64 } };
        const image = imageFromPart(part);
        expect(image.src).toBe(`data:image/webp;base64,${B64}`);
        expect(image.mime).toBe('image/webp');
    });

    test('Claude image with url source', () => {
        const part = { type: 'image', source: { type: 'url', url: 'https://example.test/img.png' } };
        const image = imageFromPart(part);
        expect(image.src).toBe('https://example.test/img.png');
    });

    test('Gemini inlineData', () => {
        const part = { inlineData: { mimeType: 'image/png', data: B64 } };
        const image = imageFromPart(part);
        expect(image.src).toBe(`data:image/png;base64,${B64}`);
        expect(image.mime).toBe('image/png');
        expect(image.sizeBytes).toBe(48);
    });

    test('Gemini fileData', () => {
        const part = { fileData: { fileUri: 'https://generativelanguage.example.test/files/abc', mimeType: 'image/png' } };
        const image = imageFromPart(part);
        expect(image.src).toBe('https://generativelanguage.example.test/files/abc');
        expect(image.mime).toBe('image/png');
        expect(image.sizeBytes).toBeNull();
    });

    test('non-image parts return null', () => {
        expect(imageFromPart({ type: 'text', text: 'hello' })).toBeNull();
        expect(imageFromPart('plain string')).toBeNull();
        expect(imageFromPart(null)).toBeNull();
        expect(imageFromPart({ type: 'tool_use', name: 'x' })).toBeNull();
    });
});

describe('responsePartToImage', () => {
    test('server-normalized image part becomes a data URL', () => {
        const image = responsePartToImage({ type: 'image', mime: 'image/png', data: B64 });
        expect(image.src).toBe(`data:image/png;base64,${B64}`);
        expect(image.sizeBytes).toBe(48);
    });

    test('non-image parts return null', () => {
        expect(responsePartToImage({ type: 'text', text: 'hi' })).toBeNull();
        expect(responsePartToImage(null)).toBeNull();
    });
});

describe('extractMessageImages', () => {
    test('collects images in order from a content array', () => {
        const content = [
            { type: 'text', text: 'look' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${B64}` } },
            { inlineData: { mimeType: 'image/jpeg', data: B64 } },
        ];
        const images = extractMessageImages(content);
        expect(images).toHaveLength(2);
        expect(images[0].mime).toBe('image/png');
        expect(images[1].mime).toBe('image/jpeg');
    });

    test('recurses into tool_result content', () => {
        const content = [
            { type: 'tool_result', tool_use_id: 't1', content: [
                { type: 'image_url', image_url: { url: `data:image/gif;base64,${B64}` } },
            ] },
        ];
        const images = extractMessageImages(content);
        expect(images).toHaveLength(1);
        expect(images[0].mime).toBe('image/gif');
    });

    test('string content and non-arrays yield nothing', () => {
        expect(extractMessageImages('text only')).toEqual([]);
        expect(extractMessageImages(null)).toEqual([]);
    });
});

describe('describeImagePart', () => {
    test('inline images report mime and decoded size', () => {
        const part = { type: 'image_url', image_url: { url: `data:image/png;base64,${B64}` } };
        expect(describeImagePart(part)).toBe('[image: image/png, 48B]');
    });

    test('remote URLs are truncated to a prefix', () => {
        const url = `https://example.test/${'a'.repeat(120)}.png`;
        const desc = describeImagePart({ type: 'image_url', image_url: { url } });
        expect(desc).toContain('[image: https://example.test/');
        expect(desc.endsWith('\u2026]')).toBe(true);
        expect(desc).not.toContain('.png');
    });

    test('non-images return empty string so callers fall through', () => {
        expect(describeImagePart({ type: 'text', text: 'hi' })).toBe('');
    });
});

describe('imageToHtml', () => {
    test('markup carries src, lazy loading and escaped attributes', () => {
        const html = imageToHtml({ src: `data:image/png;base64,${B64}`, mime: 'image/png', sizeBytes: 48 });
        expect(html).toContain('class="ri-img"');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain(`src="data:image/png;base64,${B64}"`);
        expect(html).toContain('title="image/png, 48B"');
    });

    test('attribute-hostile characters are escaped', () => {
        const html = imageToHtml({ src: 'https://example.test/a"?<b>', mime: '', sizeBytes: null });
        expect(html).toContain('"');
        expect(html).toContain('<');
        expect(html).not.toContain('<b>');
    });

    test('missing src renders nothing', () => {
        expect(imageToHtml(null)).toBe('');
        expect(imageToHtml({ src: '' })).toBe('');
    });
});

describe('elideBase64Json', () => {
    test('long data URLs are elided with mime and size', () => {
        const payload = 'A'.repeat(5000);
        const json = elideBase64Json({ url: `data:image/png;base64,${payload}` });
        expect(json).toContain('[elided image: image/png, 3.7KB]');
        expect(json).not.toContain(payload);
    });

    test('long raw base64 strings are elided', () => {
        const payload = 'B'.repeat(10000);
        const json = elideBase64Json({ inlineData: { mimeType: 'image/png', data: payload } });
        expect(json).toContain('[elided base64, 7.3KB]');
        expect(json).not.toContain(payload);
        expect(json).toContain('"mimeType": "image/png"');
    });

    test('short strings, JSON structure and non-base64 long strings survive', () => {
        const longToken = `jwt-${'c'.repeat(5000)}`; // long but not base64
        const json = elideBase64Json({ model: 'gpt-x', short: 'AAAA', token: longToken });
        expect(json).toContain('"model": "gpt-x"');
        expect(json).toContain('"short": "AAAA"');
        expect(json).toContain(longToken);
    });

    test('a full Gemini wire body elides inline images but keeps text parts', () => {
        const big = 'D'.repeat(8192);
        const wr = {
            contents: [
                { role: 'user', parts: [
                    { text: 'describe this' },
                    { inlineData: { mimeType: 'image/png', data: big } },
                ] },
            ],
            generationConfig: { temperature: 0.7 },
        };
        const json = elideBase64Json(wr);
        expect(json).toContain('describe this');
        expect(json).toContain('[elided base64, 6.0KB]');
        expect(json).not.toContain(big);
        expect(json).toContain('"temperature": 0.7');
    });
});
