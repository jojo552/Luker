import { describe, it, expect } from '@ohos/hypium';
import {
  DEFAULT_LOCAL_BASE_URL,
  isLocalBaseUrl,
  normalizeCustomBaseUrl,
  resolveBaseUrl,
} from '../main/ets/EndpointUrl';

export default function endpointUrlTest(): void {
  describe('EndpointUrl', () => {
    it('defaults to the local runtime', 0, () => {
      expect(resolveBaseUrl(null)).assertEqual(DEFAULT_LOCAL_BASE_URL);
      expect(resolveBaseUrl('')).assertEqual(DEFAULT_LOCAL_BASE_URL);
    });

    it('accepts http and https origins', 0, () => {
      expect(normalizeCustomBaseUrl('http://example.com')).assertEqual('http://example.com');
      expect(normalizeCustomBaseUrl('https://example.com')).assertEqual('https://example.com');
    });

    it('trims whitespace and trailing slashes', 0, () => {
      expect(normalizeCustomBaseUrl('  https://example.com/  ')).assertEqual('https://example.com');
      expect(normalizeCustomBaseUrl('http://example.com/')).assertEqual('http://example.com');
    });

    it('keeps a port', 0, () => {
      expect(normalizeCustomBaseUrl('http://192.168.1.5:8000'))
        .assertEqual('http://192.168.1.5:8000');
    });

    it('rejects missing schemes and non-http schemes', 0, () => {
      expect(normalizeCustomBaseUrl('example.com')).assertNull();
      expect(normalizeCustomBaseUrl('ftp://example.com')).assertNull();
      expect(normalizeCustomBaseUrl('')).assertNull();
      expect(normalizeCustomBaseUrl('   ')).assertNull();
    });

    it('rejects paths, query strings and fragments', 0, () => {
      expect(normalizeCustomBaseUrl('https://example.com/luker')).assertNull();
      expect(normalizeCustomBaseUrl('https://example.com/luker/chat')).assertNull();
      expect(normalizeCustomBaseUrl('https://example.com?x=1')).assertNull();
      expect(normalizeCustomBaseUrl('https://example.com/#/chat')).assertNull();
    });

    it('rejects invalid authorities', 0, () => {
      expect(normalizeCustomBaseUrl('http://')).assertNull();
      expect(normalizeCustomBaseUrl('http://:8000')).assertNull();
      expect(normalizeCustomBaseUrl('http://example.com:')).assertNull();
      expect(normalizeCustomBaseUrl('http://example.com:99999')).assertNull();
      expect(normalizeCustomBaseUrl('http://example.com:abc')).assertNull();
      expect(normalizeCustomBaseUrl('https://example.com/a b')).assertNull();
      expect(normalizeCustomBaseUrl('https://user:pass@example.com')).assertNull();
      expect(normalizeCustomBaseUrl('https://example.com\\luker')).assertNull();
    });

    it('accepts bracketed IPv6 authorities', 0, () => {
      expect(normalizeCustomBaseUrl('http://[::1]:8000')).assertEqual('http://[::1]:8000');
    });

    it('recognises the local origin', 0, () => {
      expect(isLocalBaseUrl('http://127.0.0.1:8000')).assertTrue();
      expect(isLocalBaseUrl('http://localhost:8000')).assertTrue();
      expect(isLocalBaseUrl('HTTP://LOCALHOST:8000/')).assertTrue();
      expect(isLocalBaseUrl('http://127.0.0.1:08000')).assertTrue();
      expect(isLocalBaseUrl('http://localhost.:8000')).assertTrue();
      expect(isLocalBaseUrl('http://localhost')).assertFalse();
      expect(isLocalBaseUrl('https://localhost:8000')).assertFalse();
      expect(isLocalBaseUrl('http://[::1]:8000')).assertFalse();
      expect(isLocalBaseUrl('https://example.com')).assertFalse();
      expect(isLocalBaseUrl('not a url')).assertFalse();
    });

    it('resolves a custom endpoint as-is', 0, () => {
      expect(resolveBaseUrl('https://example.com')).assertEqual('https://example.com');
    });
  });
}
