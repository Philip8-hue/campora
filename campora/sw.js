self.addEventListener("push", event => {
    event.waitUntil((async () => {
        let data = {};
        try { data = event.data?.json() || {}; } catch {}
        await self.registration.showNotification("Campora", {
            body: data.body || "You have new activity on Campora.",
            tag: data.tag || "campora",
            icon: "/favicon.png",
            data: { url: "/?notifications=1" }
        });
    })());
});
self.addEventListener("notificationclick", event => {
    event.notification.close();
    event.waitUntil(self.clients.openWindow(new URL("/?notifications=1", self.location.origin).href));
});
