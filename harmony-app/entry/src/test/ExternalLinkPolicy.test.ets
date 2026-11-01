import { describe, it, expect } from '@ohos/hypium';
import {
  ExternalLinkSettings,
  LinkRoute,
  originOf,
  routeNewWindow,
  routeTopLevelNavigation,
} from '../main/ets/ExternalLinkPolicy';

const APP_ORIGIN: string = 'http://127.0.0.1:8000';

export default function externalLinkPolicyTest(): void {
  describe('ExternalLinkPolicy', () => {
    it('origin strips path, query and fragment', 0, () => {
      expect(originOf(APP_ORIGIN + '/chat?x=1#y')).assertEqual(APP_ORIGIN);
      expect(originOf('HTTP://127.0.0.1:8000')).assertEqual(APP_ORIGIN);
    });

    it('origin drops the scheme default port', 0, () => {
      expect(originOf('https://example.com:443/a')).assertEqual('https://example.com');
      expect(originOf('http://example.com:80/a')).assertEqual('http://example.com');
    });

    it('origin keeps a non-numeric port tail in the host', 0, () => {
      expect(originOf('https://example.com:abc/')).assertEqual('https://example.com:abc');
    });

    it('origin is empty for a scheme-less or non-hierarchical url', 0, () => {
      expect(originOf('about:blank')).assertEqual('');
      expect(originOf('')).assertEqual('');
    });

    it('top level navigation to an external https url goes to the browser', 0, () => {
      expect(routeTopLevelNavigation('https://example.com/x', APP_ORIGIN, APP_ORIGIN, true))
        .assertEqual(LinkRoute.SystemBrowser);
    });

    it('top level navigation stays in app when the toggle is off', 0, () => {
      expect(routeTopLevelNavigation('https://example.com/x', APP_ORIGIN, APP_ORIGIN, false))
        .assertEqual(LinkRoute.InApp);
    });

    it('top level navigation to the app origin stays in app', 0, () => {
      expect(routeTopLevelNavigation(APP_ORIGIN + '/chat', APP_ORIGIN, APP_ORIGIN, true))
        .assertEqual(LinkRoute.InApp);
    });

    it('a different port is a different origin', 0, () => {
      expect(routeTopLevelNavigation('http://127.0.0.1:8001/', APP_ORIGIN, APP_ORIGIN, true))
        .assertEqual(LinkRoute.SystemBrowser);
    });

    it('non http schemes stay in app', 0, () => {
      const urls: Array<string> = [
        'about:blank',
        'blob:' + APP_ORIGIN + '/0f1e',
        'data:text/html,<a href="https://example.com">x</a>',
        'file:///data/x.html',
      ];
      for (let i = 0; i < urls.length; i++) {
        expect(routeTopLevelNavigation(urls[i], APP_ORIGIN, APP_ORIGIN, true)).assertEqual(LinkRoute.InApp);
      }
    });

    it('an external current page keeps its own navigations in app', 0, () => {
      expect(routeTopLevelNavigation('https://example.com/session', 'https://example.com/signin', APP_ORIGIN, true))
        .assertEqual(LinkRoute.InApp);
      expect(routeTopLevelNavigation('https://example.com/y', 'https://example.com:443/x', APP_ORIGIN, true))
        .assertEqual(LinkRoute.InApp);
      expect(routeTopLevelNavigation('https://other.example/y', 'https://example.com/x', APP_ORIGIN, true))
        .assertEqual(LinkRoute.InApp);
      expect(routeTopLevelNavigation('https://example.com/y', 'https://example.com/x', APP_ORIGIN, false))
        .assertEqual(LinkRoute.InApp);
    });

    it('an empty or unknown current page counts as the app page', 0, () => {
      expect(routeTopLevelNavigation('https://example.com/a', APP_ORIGIN + '/', APP_ORIGIN, true))
        .assertEqual(LinkRoute.SystemBrowser);
      expect(routeTopLevelNavigation('https://example.com/a', '', APP_ORIGIN, true))
        .assertEqual(LinkRoute.SystemBrowser);
      expect(routeTopLevelNavigation('https://example.com/a', 'about:blank', APP_ORIGIN, true))
        .assertEqual(LinkRoute.SystemBrowser);
      expect(routeTopLevelNavigation('https://example.com/a', 'about:blank', APP_ORIGIN, false))
        .assertEqual(LinkRoute.InApp);
    });

    it('a feature popup stays in app regardless of the toggle', 0, () => {
      expect(routeNewWindow('https://example.com/auth', true, APP_ORIGIN, true))
        .assertEqual(LinkRoute.Popup);
      expect(routeNewWindow('https://example.com/auth', true, APP_ORIGIN, false))
        .assertEqual(LinkRoute.Popup);
    });

    it('a featureless new window follows the top level rule', 0, () => {
      expect(routeNewWindow('https://example.com/x', false, APP_ORIGIN, true))
        .assertEqual(LinkRoute.SystemBrowser);
      expect(routeNewWindow('https://example.com/x', false, APP_ORIGIN, false))
        .assertEqual(LinkRoute.InApp);
    });

    it('a path under the app origin stays in app when given the origin', 0, () => {
      const appOrigin: string = originOf('https://example.com/luker');
      expect(appOrigin).assertEqual('https://example.com');
      expect(routeTopLevelNavigation('https://example.com/chat', 'https://example.com/luker',
        appOrigin, true)).assertEqual(LinkRoute.InApp);
      expect(routeTopLevelNavigation('https://other.example/x', 'https://example.com/luker',
        appOrigin, true)).assertEqual(LinkRoute.SystemBrowser);
    });

    it('settings hold the toggle defaulting to on', 0, () => {
      expect(ExternalLinkSettings.isOpenExternally()).assertTrue();
      ExternalLinkSettings.setOpenExternally(false);
      expect(ExternalLinkSettings.isOpenExternally()).assertFalse();
      ExternalLinkSettings.setOpenExternally(true);
      expect(ExternalLinkSettings.isOpenExternally()).assertTrue();
    });
  });
}
