async function loadPublishedListings() {
    const records = await campusApi("listings");
    for (const [kind, id, empty] of [
        ["event", "publishedEvents", "No upcoming events."],
        ["opportunity", "publishedOpportunities", "No open opportunities."],
        ["event", "exploreEvents", "No upcoming events."],
        ["opportunity", "exploreOpportunities", "No open opportunities."]
    ]) {
        const container = document.getElementById(id);
        const rows = records.filter(listing => listing.kind === kind).map(listingRow);
        container.replaceChildren(...rows);
        if (!rows.length) container.textContent = empty;
    }
}

async function loadLeaderboard() {
    const groups = await campusApi("leaderboard");
    const list = document.getElementById("campusLeaderboard");
    list.replaceChildren(...groups.map(group => {
        const row = document.createElement("li");
        row.textContent = group.name + " · " + group.members + (group.members === 1 ? " member" : " members");
        return row;
    }));
    if (!groups.length) {
        const row = document.createElement("li");
        row.textContent = "Rankings start when students join groups.";
        list.append(row);
    }
}

const broadcastForm = document.getElementById("broadcastForm");
const video = document.getElementById("broadcastVideo");
const stopBroadcast = document.getElementById("stopBroadcast");
const broadcastStatus = document.getElementById("broadcastStatus");
let activeBroadcast;
let loadingRooms = false;

function gatherIce(peer) {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise(resolve => {
        const finish = () => {
            clearTimeout(timeout);
            peer.removeEventListener("icegatheringstatechange", check);
            resolve();
        };
        const check = () => { if (peer.iceGatheringState === "complete") finish(); };
        const timeout = setTimeout(finish, 8000);
        peer.addEventListener("icegatheringstatechange", check);
    });
}

function showBroadcast(active, message = "") {
    video.hidden = !active;
    stopBroadcast.hidden = !active;
    stopBroadcast.textContent = active?.host ? "End broadcast" : "Leave broadcast";
    broadcastForm.hidden = Boolean(active);
    broadcastStatus.textContent = message;
}

async function closeBroadcast(notify = true) {
    const active = activeBroadcast;
    activeBroadcast = null;
    if (!active) return;
    clearInterval(active.timer);
    active.stream?.getTracks().forEach(track => track.stop());
    active.connections.forEach(entry => entry.peer.close());
    video.srcObject = null;
    showBroadcast(null);
    if (notify && active.id) await campusApi("broadcast", { id: active.id, action: active.host ? "end" : "leave" });
}

function signal(active, action, extra = {}) {
    return campusApi("broadcast", { id: active.id, action, ...extra });
}

async function pollBroadcast(active) {
    if (activeBroadcast !== active || active.polling) return;
    active.polling = true;
    try {
        const result = await signal(active, "poll");
        if (activeBroadcast !== active) return;
        if (!active.host) {
            const peer = active.connections.get("host").peer;
            if (result.answer && !peer.remoteDescription) await peer.setRemoteDescription({ type: "answer", sdp: result.answer });
            return;
        }
        for (const [id, entry] of active.connections) {
            if (!result.some(viewer => viewer.id === id && viewer.offer === entry.offer)) {
                entry.peer.close();
                active.connections.delete(id);
            }
        }
        await Promise.all(result.filter(viewer => !viewer.answered).map(async viewer => {
            if (active.connections.has(viewer.id)) return;
            const peer = new RTCPeerConnection({ iceServers: active.iceServers });
            active.connections.set(viewer.id, { peer, offer: viewer.offer });
            try {
                active.stream.getTracks().forEach(track => peer.addTrack(track, active.stream));
                await peer.setRemoteDescription({ type: "offer", sdp: viewer.offer });
                await peer.setLocalDescription(await peer.createAnswer());
                await gatherIce(peer);
                if (activeBroadcast === active) await signal(active, "answer", { viewer: viewer.id, offer: viewer.offer, sdp: peer.localDescription.sdp });
            } catch {
                peer.close();
                active.connections.delete(viewer.id);
            }
        }));
    } catch (error) {
        if (activeBroadcast === active) {
            await closeBroadcast(false);
            showBroadcast(null, error.message);
        }
    } finally {
        active.polling = false;
    }
}

function startPolling(active) {
    active.timer = setInterval(() => pollBroadcast(active), 1500);
    pollBroadcast(active);
}

broadcastForm.addEventListener("submit", event => {
    event.preventDefault();
    campusAction(event.submitter, async () => {
        if (activeBroadcast) return;
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Open Campora over HTTPS to use your camera.");
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        try {
            const title = document.getElementById("broadcastTitle").value;
            const iceServers = await campusApi("ice");
            const room = await campusApi("broadcast", { action: "start", title });
            const active = { ...room, iceServers, host: true, stream, connections: new Map() };
            activeBroadcast = active;
            video.muted = true;
            video.srcObject = stream;
            showBroadcast(active, "You’re live.");
            startPolling(active);
        } catch (error) {
            stream.getTracks().forEach(track => track.stop());
            throw error;
        }
        loadBroadcasts().catch(campusError);
    });
});

async function watchBroadcast(room) {
    if (activeBroadcast) return;
    const iceServers = await campusApi("ice");
    if (activeBroadcast) return;
    const peer = new RTCPeerConnection({ iceServers });
    const active = { id: room.id, host: false, connections: new Map([["host", { peer }]]) };
    activeBroadcast = active;
    showBroadcast(active, "Connecting to the broadcast…");
    video.muted = true;
    peer.ontrack = event => { video.srcObject = event.streams[0]; };
    peer.onconnectionstatechange = () => {
        if (activeBroadcast !== active) return;
        if (peer.connectionState === "connected") broadcastStatus.textContent = "Watching " + room.title + ". Unmute for sound.";
        if (peer.connectionState === "failed") {
            closeBroadcast().catch(campusError);
            broadcastStatus.textContent = "Could not connect to this broadcast.";
        }
    };
    try {
        peer.addTransceiver("video", { direction: "recvonly" });
        peer.addTransceiver("audio", { direction: "recvonly" });
        await peer.setLocalDescription(await peer.createOffer());
        await gatherIce(peer);
        if (activeBroadcast !== active) return;
        await signal(active, "offer", { sdp: peer.localDescription.sdp });
        if (activeBroadcast === active) startPolling(active);
        else await signal(active, "leave");
    } catch (error) {
        if (activeBroadcast === active) await closeBroadcast(false);
        throw error;
    }
}

async function loadBroadcasts() {
    if (loadingRooms) return;
    loadingRooms = true;
    try {
        const { rooms } = await campusApi("broadcast");
        const container = document.getElementById("broadcastRooms");
        const key = JSON.stringify(rooms);
        if (container.dataset.rooms === key) return;
        container.dataset.rooms = key;
        container.replaceChildren(...rooms.map(room => {
            const row = listingRow({ title: room.title });
            if (!room.own) row.append(campusButton("Watch", () => watchBroadcast(room)));
            return row;
        }));
        if (!rooms.length) container.textContent = "No one is live right now.";
    } finally { loadingRooms = false; }
}

stopBroadcast.addEventListener("click", () => campusAction(stopBroadcast, async () => {
    await closeBroadcast();
    await loadBroadcasts();
}));
window.addEventListener("pagehide", () => {
    const active = activeBroadcast;
    if (!active) return;
    navigator.sendBeacon("/api/broadcast", JSON.stringify({ id: active.id, action: active.host ? "end" : "leave" }));
    closeBroadcast(false);
});

function refreshCampusOperations(tab) {
    if (["home", "opportunities", "explore"].includes(tab)) loadPublishedListings().catch(campusError);
    if (tab === "home") loadLeaderboard().catch(campusError);
    if (tab === "live") loadBroadcasts().catch(campusError);
}

document.getElementById("adminLink").hidden = !window.camporaModerator;
refreshCampusOperations("home");
setInterval(() => {
    if (!document.hidden && document.getElementById("tab-live").classList.contains("active")) loadBroadcasts().catch(campusError);
}, 4000);
