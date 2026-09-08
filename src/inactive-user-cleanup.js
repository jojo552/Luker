/**
 * 选择需要清理的不活跃用户。
 *
 * @param {Array<{handle: string, admin?: boolean, lastActivity?: number}>} users 用户列表
 * @param {{now?: number, inactivityDays: number, defaultHandle?: string}} options 清理参数
 * @returns {Array<{handle: string, admin?: boolean, lastActivity?: number}>} 待清理用户
 */
export function selectInactiveUsers(users, { now = Date.now(), inactivityDays, defaultHandle }) {
    const cutoff = now - inactivityDays * 24 * 60 * 60 * 1000;

    return users.filter(user => {
        const lastActivity = Number(user.lastActivity);
        return user.handle !== defaultHandle
            && !user.admin
            && Number.isFinite(lastActivity)
            && lastActivity <= cutoff;
    });
}
