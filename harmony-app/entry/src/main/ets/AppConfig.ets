import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { isLocalBaseUrl, normalizeCustomBaseUrl, resolveBaseUrl } from './EndpointUrl';

const TAG: string = 'luker.config';
const DOMAIN: number = 0xE1EC;
const STORE_NAME: string = 'luker_config';
const KEY_CUSTOM_BASE_URL: string = 'custom_base_url';
const KEY_NOTIFICATION_PROMPTED: string = 'notification_prompted';

/**
 * Persists the endpoint selection and the one-time notification prompt flag.
 * Values are read synchronously because the ability has to decide whether to
 * start the local backend before the page is created.
 */
export class AppConfig {
  private static store: preferences.Preferences | null = null;
  private static failure: string = '';

  static attach(context: common.Context): void {
    if (AppConfig.store !== null) {
      return;
    }
    try {
      AppConfig.store = preferences.getPreferencesSync(context, { name: STORE_NAME });
      AppConfig.failure = '';
    } catch (e) {
      AppConfig.store = null;
      AppConfig.failure = 'preferences unavailable: ' + String(e);
      hilog.error(DOMAIN, TAG, 'getPreferencesSync failed: %{public}s', JSON.stringify(e));
    }
  }

  static warning(): string {
    return AppConfig.failure;
  }

  static customBaseUrl(): string | null {
    const store: preferences.Preferences | null = AppConfig.store;
    if (store === null) {
      return null;
    }
    let raw: string = '';
    try {
      raw = String(store.getSync(KEY_CUSTOM_BASE_URL, ''));
    } catch (e) {
      AppConfig.failure = 'read custom_base_url failed: ' + String(e);
      hilog.error(DOMAIN, TAG, 'read custom_base_url failed: %{public}s', JSON.stringify(e));
      return null;
    }
    if (raw.length === 0) {
      return null;
    }
    const normalized: string | null = normalizeCustomBaseUrl(raw);
    if (normalized === null) {
      AppConfig.failure = 'invalid custom_base_url: ' + raw;
      hilog.error(DOMAIN, TAG, 'invalid custom_base_url: %{public}s', raw);
      return null;
    }
    if (isLocalBaseUrl(normalized)) {
      return null;
    }
    return normalized;
  }

  static resolveBaseUrl(): string {
    return resolveBaseUrl(AppConfig.customBaseUrl());
  }

  static usesCustomEndpoint(): boolean {
    return AppConfig.customBaseUrl() !== null;
  }

  static saveCustomBaseUrl(url: string): void {
    if (isLocalBaseUrl(url)) {
      AppConfig.resetCustomBaseUrl();
      return;
    }
    const store: preferences.Preferences = AppConfig.requireStore();
    const previous: string = String(store.getSync(KEY_CUSTOM_BASE_URL, ''));
    try {
      store.putSync(KEY_CUSTOM_BASE_URL, url);
      store.flushSync();
    } catch (e) {
      AppConfig.restore(store, previous);
      throw new Error('save custom endpoint failed: ' + String(e));
    }
    AppConfig.failure = '';
  }

  static resetCustomBaseUrl(): void {
    const store: preferences.Preferences = AppConfig.requireStore();
    const previous: string = String(store.getSync(KEY_CUSTOM_BASE_URL, ''));
    try {
      if (store.hasSync(KEY_CUSTOM_BASE_URL)) {
        store.deleteSync(KEY_CUSTOM_BASE_URL);
      }
      store.flushSync();
    } catch (e) {
      AppConfig.restore(store, previous);
      throw new Error('reset custom endpoint failed: ' + String(e));
    }
    AppConfig.failure = '';
  }

  private static restore(store: preferences.Preferences, previous: string): void {
    try {
      if (previous.length === 0) {
        if (store.hasSync(KEY_CUSTOM_BASE_URL)) {
          store.deleteSync(KEY_CUSTOM_BASE_URL);
        }
      } else {
        store.putSync(KEY_CUSTOM_BASE_URL, previous);
      }
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'endpoint rollback failed: %{public}s', JSON.stringify(e));
    }
  }

  static notificationPrompted(): boolean {
    const store: preferences.Preferences | null = AppConfig.store;
    if (store === null) {
      return false;
    }
    try {
      return store.getSync(KEY_NOTIFICATION_PROMPTED, false) === true;
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'read notification_prompted failed: %{public}s', JSON.stringify(e));
      return false;
    }
  }

  static markNotificationPrompted(): void {
    const store: preferences.Preferences | null = AppConfig.store;
    if (store === null) {
      return;
    }
    try {
      store.putSync(KEY_NOTIFICATION_PROMPTED, true);
      store.flushSync();
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'write notification_prompted failed: %{public}s', JSON.stringify(e));
    }
  }

  private static requireStore(): preferences.Preferences {
    if (AppConfig.store === null) {
      throw new Error('AppConfig.attach has not completed');
    }
    return AppConfig.store;
  }
}
