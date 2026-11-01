// SPDX-License-Identifier: AGPL-3.0-or-later
import { extractImageMeta } from '../src/request-inspector.js';

// Shape produced by the ComfyUI client: the workflow graph is nested under
// `prompt`, because this string is posted verbatim to ComfyUI's /prompt route.
const workflow = {
    '3': {
        class_type: 'KSampler',
        inputs: {
            seed: 42,
            steps: 30,
            cfg: 6.5,
            sampler_name: 'euler',
            positive: ['6', 0],
            negative: ['7', 0],
        },
    },
    '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'model.safetensors' },
    },
    '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: 832, height: 1216 },
    },
    '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'masterpiece, a castle above the clouds' },
    },
    '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'lowres, blurry' },
    },
};

describe('extractImageMeta: ComfyUI workflow', () => {
    test('reads the node graph from the wrapped /prompt request body', () => {
        const meta = extractImageMeta('comfyui', {
            prompt: JSON.stringify({ prompt: workflow }),
        });

        expect(meta.prompt).toBe('masterpiece, a castle above the clouds');
        expect(meta.negativePrompt).toBe('lowres, blurry');
        expect(meta.model).toBe('model.safetensors');
        expect(meta.width).toBe(832);
        expect(meta.height).toBe(1216);
        expect(meta.steps).toBe(30);
        expect(meta.cfgScale).toBe(6.5);
        expect(meta.seed).toBe(42);
        expect(meta.sampler).toBe('euler');
    });

    test('follows the sampler positive and negative links regardless of node order', () => {
        const reversed = {
            '7': workflow['7'],
            '6': workflow['6'],
            '3': workflow['3'],
        };

        const meta = extractImageMeta('comfyui_runpod', {
            prompt: JSON.stringify({ prompt: reversed }),
        });

        expect(meta.prompt).toBe('masterpiece, a castle above the clouds');
        expect(meta.negativePrompt).toBe('lowres, blurry');
    });

    test('still accepts a bare node graph', () => {
        const meta = extractImageMeta('comfyui', {
            prompt: JSON.stringify(workflow),
        });

        expect(meta.prompt).toBe('masterpiece, a castle above the clouds');
        expect(meta.negativePrompt).toBe('lowres, blurry');
    });
});
