// SPDX-License-Identifier: AGPL-3.0-or-later
import { extractImageMeta } from '../src/request-inspector.js';

describe('extractImageMeta: backend request fields', () => {
    test('nanogpt reads num_steps, scale, and dimensions', () => {
        const meta = extractImageMeta('nanogpt', {
            model: 'nano-model',
            prompt: 'a castle',
            negative_prompt: 'blurry',
            num_steps: 24,
            scale: 6,
            width: 1024,
            height: 768,
        });

        expect(meta.prompt).toBe('a castle');
        expect(meta.negativePrompt).toBe('blurry');
        expect(meta.model).toBe('nano-model');
        expect(meta.steps).toBe(24);
        expect(meta.cfgScale).toBe(6);
        expect(meta.width).toBe(1024);
        expect(meta.height).toBe(768);
    });

    test('aimlapi reads SD parameters and parses an OpenAI-style size', () => {
        const sdLike = extractImageMeta('aimlapi', {
            model: 'flux/schnell',
            prompt: 'a castle',
            steps: 30,
            guidance: 4.5,
            width: 832,
            height: 1216,
            seed: 7,
        });
        expect(sdLike.steps).toBe(30);
        expect(sdLike.cfgScale).toBe(4.5);
        expect(sdLike.width).toBe(832);
        expect(sdLike.height).toBe(1216);
        expect(sdLike.seed).toBe(7);

        const openAiLike = extractImageMeta('aimlapi', {
            model: 'gpt-image-1',
            prompt: 'a castle',
            size: '1024x1024',
        });
        expect(openAiLike.width).toBe(1024);
        expect(openAiLike.height).toBe(1024);
    });

    test('workersai reads the negative prompt and sampling parameters', () => {
        const meta = extractImageMeta('workersai', {
            model: '@cf/model',
            prompt: 'a castle',
            negative_prompt: 'blurry',
            width: 640,
            height: 480,
            steps: 8,
            scale: 3,
            seed: 99,
        });

        expect(meta.negativePrompt).toBe('blurry');
        expect(meta.width).toBe(640);
        expect(meta.height).toBe(480);
        expect(meta.steps).toBe(8);
        expect(meta.cfgScale).toBe(3);
        expect(meta.seed).toBe(99);
    });

    test('zai parses its WxH size string', () => {
        const meta = extractImageMeta('zai', {
            model: 'glm-image',
            prompt: 'a castle',
            size: '1344x768',
        });

        expect(meta.width).toBe(1344);
        expect(meta.height).toBe(768);
    });

    test('chutes reads guidance_scale as the CFG scale', () => {
        const meta = extractImageMeta('chutes', {
            model: 'chutes-model',
            prompt: 'a castle',
            guidance_scale: 5.5,
        });

        expect(meta.cfgScale).toBe(5.5);
    });

    test('stability reads the negative prompt from payload', () => {
        const meta = extractImageMeta('stability', {
            model: 'sd3',
            payload: { prompt: 'a castle', negative_prompt: 'blurry' },
        });

        expect(meta.negativePrompt).toBe('blurry');
    });

    test('falai reads the negative prompt', () => {
        const meta = extractImageMeta('falai', {
            model: 'fal-model',
            prompt: 'a castle',
            negative_prompt: 'blurry',
        });

        expect(meta.negativePrompt).toBe('blurry');
    });

    test('sd_cpp reads the requested model', () => {
        const meta = extractImageMeta('sd_cpp', {
            model: 'sd-model.safetensors',
            prompt: 'a castle',
        });

        expect(meta.model).toBe('sd-model.safetensors');
    });
});
