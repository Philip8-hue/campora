(async () => {
    const enable = document.getElementById("enablePhoneNotifications");
    const disable = document.getElementById("disablePhoneNotifications");
    const status = document.getElementById("phoneNotificationStatus");
    if (!enable) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        status.textContent = "This browser cannot enable phone notifications. On iPhone, add Campora to your Home Screen and open it there.";
        return;
    }
    let registration;
    let key;
    function show(enabled) {
        enable.hidden = enabled;
        disable.hidden = !enabled;
    }
    try {
        const config = await campusApi("push");
        key = config.publicKey;
        if (!key) { status.textContent = "Phone notifications are being set up. Please try again later."; return; }
        registration = await navigator.serviceWorker.register("/sw.js");
        registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (existing && Notification.permission === "granted") {
            await campusApi("push", { subscription: existing.toJSON() });
            show(true);
            status.textContent = "Notifications are enabled on this device.";
        }
        enable.disabled = false;
    } catch {
        status.textContent = "Couldn’t set up phone notifications. Reload to try again.";
        return;
    }
    enable.addEventListener("click", async () => {
        // Request permission directly in the button gesture for iOS.
        const permission = Notification.requestPermission();
        enable.disabled = true;
        try {
            if (await permission !== "granted") {
                status.textContent = "Notifications were not allowed. You can change this in your browser’s site settings.";
                return;
            }
            const padded = (key + "=".repeat((4 - key.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
            const applicationServerKey = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
            const subscription = await registration.pushManager.getSubscription() ||
                await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
            await campusApi("push", { subscription: subscription.toJSON() });
            show(true);
            status.textContent = "Notifications are enabled on this device.";
        } catch { status.textContent = "Couldn’t enable notifications. Check your browser settings and try again."; }
        finally { enable.disabled = false; }
    });
    disable.addEventListener("click", async () => {
        disable.disabled = true;
        try {
            await campusApi("push", { action: "disable" });
            const subscription = await registration.pushManager.getSubscription();
            if (subscription) await subscription.unsubscribe();
            show(false);
            status.textContent = "Phone notifications are off on this device.";
        } catch { status.textContent = "Couldn’t turn notifications off. Please try again."; }
        finally { disable.disabled = false; }
    });
})();
