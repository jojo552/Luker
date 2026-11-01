// SPDX-License-Identifier: AGPL-3.0-or-later
import {
    completeImageInspection,
    getBufferForHandle,
    startImageInspection,
} from '../src/request-inspector.js';

let counter = 0;

function newRequest() {
    counter++;
    return {
        user: { profile: { handle: `ri-image-${counter}` } },
        body: {},
    };
}

function getEntry(request) {
    return getBufferForHandle(request.user.profile.handle)
        .find(e => e.id === request.__inspectorId) ?? null;
}

describe('image inspection output', () => {
    const imageData = Buffer.from('fake-png-bytes').toString('base64');

    test('stores the generated image supplied by the dispatch', () => {
        const request = newRequest();
        startImageInspection(request, { source: 'comfyui', prompt: 'a castle' });
        completeImageInspection(request, {
            format: 'png',
            sizeBytes: 14,
            data: imageData,
        });

        const entry = getEntry(request);
        expect(entry.outputImage).toEqual({
            type: 'image',
            mime: 'image/png',
            data: imageData,
        });
        expect(entry.outputFormat).toBe('png');
        expect(entry.outputSizeBytes).toBe(14);
        expect(entry.status).toBe('success');
    });

    test('maps the jpg format onto the image/jpeg mime type', () => {
        const request = newRequest();
        startImageInspection(request, { source: 'comfyui_runpod', prompt: 'a castle' });
        completeImageInspection(request, { format: 'jpg', data: imageData });

        expect(getEntry(request).outputImage.mime).toBe('image/jpeg');
    });

    test('derives the output size from the base64 payload when the dispatch omits it', () => {
        const request = newRequest();
        startImageInspection(request, { source: 'webui', prompt: 'a castle' });
        completeImageInspection(request, { format: 'png', data: imageData });

        const entry = getEntry(request);
        expect(entry.outputSizeBytes).toBe(Buffer.from('fake-png-bytes').length);
        expect(entry.outputImage.data).toBe(imageData);
    });

    test('leaves the image empty when the dispatch has no bytes to record', () => {
        const request = newRequest();
        startImageInspection(request, { source: 'sd_webui', prompt: 'a castle' });
        completeImageInspection(request, { format: 'png', sizeBytes: 100 });

        expect(getEntry(request).outputImage).toBeNull();
    });
});
