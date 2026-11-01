import { common, wantAgent, Want, WantAgent } from '@kit.AbilityKit';
import { BusinessError, commonEventManager } from '@kit.BasicServicesKit';
import { notificationManager } from '@kit.NotificationKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { AppConfig } from './AppConfig';
import {
  ACTION_OPEN_ENDPOINT_SETTINGS,
  ACTION_RELOAD_WEBVIEW,
  NOTIFICATION_REMOVED_EVENT,
} from './AppActions';

const TAG: string = 'luker.notification';
const DOMAIN: number = 0xE1EC;
const NOTIFICATION_ID: number = 19541;
const ERROR_NOTIFICATION_MISSING: number = 1600007;
const ERROR_NOTIFICATION_DISABLED: number = 1600004;
const REQUEST_TAP: number = 100;
const REQUEST_ENDPOINT: number = 101;
const REQUEST_RELOAD: number = 102;
const REQUEST_REMOVAL: number = 103;

/**
 * The app's normal notification: a tappable entry point with Endpoint and
 * Refresh page actions. HarmonyOS does not expose Android's ongoing flag, so
 * a foreground swipe is answered by reposting from the removal common event.
 * The event is only delivered while the app is in the foreground.
 */
export class RuntimeNotification {
  private static context: common.UIAbilityContext | null = null;
  // The subscriber must stay referenced for the dynamic subscription to live.
  private static subscriber: commonEventManager.CommonEventSubscriber | null = null;
  private static subscribed: boolean = false;
  private static foreground: boolean = false;
  private static serverReady: boolean = false;
  private static keepAliveActive: boolean = false;
  private static exiting: boolean = false;
  private static permissionRequested: boolean = false;
  private static publishing: boolean = false;
  private static publishingGeneration: number = -1;
  private static pendingShow: boolean = false;
  private static repostPending: boolean = false;
  private static abilityGeneration: number = 0;
  private static lastPublishedGeneration: number = -1;
  private static publishToken: number = 0;

  static attach(context: common.UIAbilityContext): void {
    RuntimeNotification.context = context;
    RuntimeNotification.foreground = false;
    RuntimeNotification.serverReady = false;
    RuntimeNotification.keepAliveActive = false;
    RuntimeNotification.exiting = false;
    RuntimeNotification.publishing = false;
    RuntimeNotification.publishingGeneration = -1;
    RuntimeNotification.pendingShow = false;
    RuntimeNotification.repostPending = false;
    // Both counters stay monotonic across ability recreation so an old
    // publish cannot be mistaken for one belonging to the new ability.
    RuntimeNotification.abilityGeneration++;
    RuntimeNotification.publishToken++;
    // A process kill does not run onDestroy; clear a notification left by the
    // previous process before publishing the new run's state.
    RuntimeNotification.cancelNotification();
    RuntimeNotification.subscribeRemoval();
  }

  static setForeground(foreground: boolean): void {
    RuntimeNotification.foreground = foreground;
    if (foreground) {
      RuntimeNotification.subscribeRemoval();
      RuntimeNotification.show();
    }
  }

  static setServerReady(ready: boolean): void {
    RuntimeNotification.serverReady = ready;
    if (ready) {
      RuntimeNotification.show();
    } else {
      RuntimeNotification.hide();
    }
  }

  static setKeepAliveActive(active: boolean): void {
    RuntimeNotification.keepAliveActive = active;
    if (active) {
      RuntimeNotification.hide();
    } else {
      RuntimeNotification.show();
    }
  }

  static hide(): void {
    RuntimeNotification.publishToken++;
    RuntimeNotification.lastPublishedGeneration = -1;
    RuntimeNotification.pendingShow = false;
    RuntimeNotification.repostPending = false;
    RuntimeNotification.cancelNotification();
  }

  static exit(): void {
    RuntimeNotification.exiting = true;
    RuntimeNotification.hide();
    RuntimeNotification.unsubscribeRemoval();
  }

  static ensurePermission(): void {
    if (RuntimeNotification.permissionRequested) {
      return;
    }
    const context: common.UIAbilityContext | null = RuntimeNotification.context;
    if (context === null) {
      return;
    }
    if (RuntimeNotification.notificationsEnabled()) {
      return;
    }
    if (AppConfig.notificationPrompted()) {
      return;
    }
    RuntimeNotification.permissionRequested = true;
    try {
      notificationManager.requestEnableNotification(context)
        .then(() => {
          AppConfig.markNotificationPrompted();
          RuntimeNotification.show();
        })
        .catch((err: BusinessError) => {
          if (err.code === ERROR_NOTIFICATION_DISABLED) {
            // The user saw the dialog and declined; do not ask again.
            AppConfig.markNotificationPrompted();
          } else {
            // Internal/service/dialog-already-open failures did not reach the
            // user; allow a later foreground transition to retry.
            RuntimeNotification.permissionRequested = false;
          }
          hilog.warn(DOMAIN, TAG, 'notification permission request failed: %{public}d %{public}s',
            err.code, err.message);
        });
    } catch (e) {
      RuntimeNotification.permissionRequested = false;
      hilog.error(DOMAIN, TAG, 'requestEnableNotification threw: %{public}s', JSON.stringify(e));
    }
  }

  static show(): void {
    if (!RuntimeNotification.canShow()) {
      return;
    }
    if (RuntimeNotification.publishing) {
      RuntimeNotification.pendingShow = true;
      return;
    }
    RuntimeNotification.pendingShow = false;
    if (RuntimeNotification.foreground) {
      RuntimeNotification.ensurePermission();
    }
    if (!RuntimeNotification.notificationsEnabled()) {
      return;
    }
    RuntimeNotification.publish();
  }

  private static notificationsEnabled(): boolean {
    try {
      return notificationManager.isNotificationEnabledSync();
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'isNotificationEnabledSync threw: %{public}s', JSON.stringify(e));
      return false;
    }
  }

  private static canShow(): boolean {
    return RuntimeNotification.context !== null
      && RuntimeNotification.serverReady
      && !RuntimeNotification.keepAliveActive
      && !RuntimeNotification.exiting;
  }

  private static isCurrent(token: number, generation: number): boolean {
    return generation === RuntimeNotification.abilityGeneration
      && token === RuntimeNotification.publishToken
      && RuntimeNotification.canShow();
  }

  private static subscribeRemoval(): void {
    if (RuntimeNotification.subscribed) {
      return;
    }
    try {
      const info: commonEventManager.CommonEventSubscribeInfo = {
        events: [NOTIFICATION_REMOVED_EVENT]
      };
      const subscriber: commonEventManager.CommonEventSubscriber =
        commonEventManager.createSubscriberSync(info);
      commonEventManager.subscribe(subscriber, (err: BusinessError) => {
        if (err) {
          hilog.error(DOMAIN, TAG, 'removal subscribe callback failed: %{public}d %{public}s',
            err.code, err.message);
          return;
        }
        RuntimeNotification.onRemoved();
      });
      RuntimeNotification.subscriber = subscriber;
      RuntimeNotification.subscribed = true;
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'removal subscriber setup failed: %{public}s', JSON.stringify(e));
    }
  }

  private static unsubscribeRemoval(): void {
    const subscriber: commonEventManager.CommonEventSubscriber | null =
      RuntimeNotification.subscriber;
    if (subscriber === null) {
      return;
    }
    RuntimeNotification.subscriber = null;
    RuntimeNotification.subscribed = false;
    try {
      commonEventManager.unsubscribe(subscriber, (err: BusinessError) => {
        if (err) {
          hilog.error(DOMAIN, TAG, 'removal unsubscribe failed: %{public}d %{public}s',
            err.code, err.message);
        }
      });
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'removal unsubscribe threw: %{public}s', JSON.stringify(e));
    }
  }

  private static onRemoved(): void {
    if (!RuntimeNotification.foreground
      || RuntimeNotification.keepAliveActive
      || !RuntimeNotification.serverReady
      || RuntimeNotification.exiting) {
      return;
    }
    if (RuntimeNotification.publishing) {
      // The in-flight publish will finish; answer the swipe after it.
      RuntimeNotification.repostPending = true;
      return;
    }
    hilog.info(DOMAIN, TAG, 'notification removed while foreground; reposting');
    RuntimeNotification.publish();
  }

  private static async publish(): Promise<void> {
    if (RuntimeNotification.publishing) {
      return;
    }
    const context: common.UIAbilityContext | null = RuntimeNotification.context;
    if (context === null || !RuntimeNotification.canShow()) {
      return;
    }
    if (!RuntimeNotification.notificationsEnabled()) {
      return;
    }
    const generation: number = RuntimeNotification.abilityGeneration;
    const token: number = ++RuntimeNotification.publishToken;
    let published: boolean = false;
    RuntimeNotification.publishing = true;
    RuntimeNotification.publishingGeneration = generation;
    try {
      const tapAgent: WantAgent =
        await RuntimeNotification.makeAbilityAgent(context, '', REQUEST_TAP);
      const endpointAgent: WantAgent =
        await RuntimeNotification.makeAbilityAgent(context, ACTION_OPEN_ENDPOINT_SETTINGS,
          REQUEST_ENDPOINT);
      const reloadAgent: WantAgent =
        await RuntimeNotification.makeAbilityAgent(context, ACTION_RELOAD_WEBVIEW, REQUEST_RELOAD);
      const removalAgent: WantAgent = await RuntimeNotification.makeRemovalAgent();
      if (!RuntimeNotification.isCurrent(token, generation)) {
        return;
      }
      const mgr = context.resourceManager;
      const customBaseUrl: string | null = AppConfig.customBaseUrl();
      const text: string = customBaseUrl === null
        ? mgr.getStringByNameSync('notification_text_local')
        : mgr.getStringByNameSync('notification_text_custom', customBaseUrl);
      const request: notificationManager.NotificationRequest = {
        id: NOTIFICATION_ID,
        notificationSlotType: notificationManager.SlotType.OTHER_TYPES,
        isAlertOnce: true,
        tapDismissed: false,
        content: {
          notificationContentType:
            notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title: mgr.getStringByNameSync('notification_title'),
            text: text
          }
        },
        wantAgent: tapAgent,
        actionButtons: [
          {
            title: mgr.getStringByNameSync('notification_action_endpoint'),
            wantAgent: endpointAgent
          },
          {
            title: mgr.getStringByNameSync('notification_action_reload'),
            wantAgent: reloadAgent
          }
        ],
        removalWantAgent: removalAgent
      };
      if (!RuntimeNotification.isCurrent(token, generation)) {
        return;
      }
      await notificationManager.publish(request);
      if (generation !== RuntimeNotification.abilityGeneration) {
        // A previous ability finished publishing after the new ability
        // cleared the old notification. Remove it unless the new ability has
        // already published its own notification.
        if (RuntimeNotification.publishingGeneration !==
          RuntimeNotification.abilityGeneration
          && RuntimeNotification.lastPublishedGeneration !==
          RuntimeNotification.abilityGeneration) {
          RuntimeNotification.cancelNotification();
        }
        return;
      }
      if (!RuntimeNotification.isCurrent(token, generation)) {
        // A hide or state change raced the publish; remove the stale result.
        RuntimeNotification.cancelNotification();
        return;
      }
      published = true;
      RuntimeNotification.lastPublishedGeneration = generation;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(DOMAIN, TAG, 'publish failed: %{public}d %{public}s', err.code, err.message);
    } finally {
      if (generation === RuntimeNotification.abilityGeneration) {
        RuntimeNotification.publishing = false;
        RuntimeNotification.publishingGeneration = -1;
        const repost: boolean = RuntimeNotification.repostPending;
        RuntimeNotification.repostPending = false;
        if (RuntimeNotification.pendingShow) {
          RuntimeNotification.pendingShow = false;
          if (!published || repost) {
            RuntimeNotification.show();
          }
        } else if (repost) {
          RuntimeNotification.show();
        }
      }
    }
  }

  private static cancelNotification(): void {
    const context: common.UIAbilityContext | null = RuntimeNotification.context;
    if (context === null) {
      return;
    }
    try {
      notificationManager.cancel(NOTIFICATION_ID).catch((err: BusinessError) => {
        if (err.code !== ERROR_NOTIFICATION_MISSING) {
          hilog.error(DOMAIN, TAG, 'cancel failed: %{public}d %{public}s', err.code, err.message);
        }
      });
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'cancel threw: %{public}s', JSON.stringify(e));
    }
  }

  private static async makeAbilityAgent(context: common.UIAbilityContext, action: string,
    requestCode: number): Promise<WantAgent> {
    const want: Want = {
      bundleName: context.abilityInfo.bundleName,
      abilityName: context.abilityInfo.name
    };
    if (action.length > 0) {
      want.action = action;
    }
    const info: wantAgent.WantAgentInfo = {
      wants: [want],
      actionType: wantAgent.OperationType.START_ABILITY,
      requestCode: requestCode,
      actionFlags: [wantAgent.WantAgentFlags.CONSTANT_FLAG]
    };
    return await wantAgent.getWantAgent(info);
  }

  private static async makeRemovalAgent(): Promise<WantAgent> {
    const info: wantAgent.WantAgentInfo = {
      wants: [
        {
          action: NOTIFICATION_REMOVED_EVENT,
          parameters: {}
        }
      ],
      actionType: wantAgent.OperationType.SEND_COMMON_EVENT,
      requestCode: REQUEST_REMOVAL,
      actionFlags: [wantAgent.WantAgentFlags.CONSTANT_FLAG]
    };
    return await wantAgent.getWantAgent(info);
  }
}
