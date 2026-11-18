async function campusApi(path, data) {
    const response = await fetch("/api/" + path, data === undefined ? undefined : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    if (response.status === 401) {
        const next = window.location.pathname === "/admin" ? "?next=%2Fadmin" : "";
        window.location.replace("/signin" + next);
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not complete the request.");
    return result;
}

function campusError(error) {
    const status = document.getElementById("campus-status");
    if (status) {
        status.textContent = error.message;
        status.hidden = false;
    }
}

async function campusUpload(file) {
    if (!file) return null;
    if (file.size > 5_000_000) throw new Error("Choose a file smaller than 5 MB.");
    const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read the file."));
        reader.readAsDataURL(file);
    });
    return { type: file.type, data };
}

async function campusAction(button, action) {
    if (button.disabled) return;
    button.disabled = true;
    const status = document.getElementById("campus-status");
    if (status) status.hidden = true;
    const dialog = button.closest('dialog, [role="dialog"], .profile-modal');
    dialog?.querySelector(".campus-action-error")?.remove();
    try { await action(); }
    catch (error) {
        if (dialog?.isConnected) {
            const message = document.createElement("p");
            message.className = "campus-action-error";
            message.setAttribute("role", "alert");
            message.textContent = error.message;
            button.after(message);
        } else {
            campusError(error);
        }
    }
    finally { button.disabled = false; }
}

function campusButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "auth-secondary";
    button.textContent = label;
    button.addEventListener("click", () => campusAction(button, action));
    return button;
}

function listingRow(listing) {
    const row = document.createElement("article");
    row.className = "campus-listing";
    const title = document.createElement("strong");
    title.textContent = listing.title;
    const details = document.createElement("p");
    details.textContent = [listing.date, listing.details].filter(Boolean).join(" · ");
    row.append(title, details);
    if (listing.url) {
        const link = document.createElement("a");
        link.href = listing.url;
        link.textContent = "Official details";
        link.rel = "noreferrer";
        row.append(link);
    }
    return row;
}

window.addEventListener("pageshow", async event => {
    if (!event.persisted) return;
    try {
        const response = await fetch("/auth/session", { cache: "no-store" });
        if (response.status === 401) window.location.replace("/signin");
    } catch (error) {
        campusError(error);
    }
});
function addEmojiPicker(input) {
    const choices = [
        ["😀", "Grinning face"], ["😊", "Smiling face"], ["😂", "Laughing"],
        ["😍", "Heart eyes"], ["😎", "Sunglasses"], ["🤔", "Thinking"],
        ["😭", "Crying"], ["🥳", "Celebrating"], ["👋", "Wave"],
        ["👍", "Thumbs up"], ["👏", "Applause"], ["🙏", "Thanks"],
        ["❤️", "Heart"], ["🔥", "Fire"], ["🎉", "Party"], ["📚", "Books"]
    ];
    const wrapper = document.createElement("div");
    wrapper.className = "emoji-picker";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "auth-secondary";
    toggle.textContent = "Emoji";
    toggle.setAttribute("aria-expanded", "false");
    const panel = document.createElement("div");
    panel.className = "emoji-choices";
    panel.hidden = true;
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Choose an emoji");
    let start = 0;
    let end = 0;
    const remember = () => { start = input.selectionStart; end = input.selectionEnd; };
    input.addEventListener("select", remember);
    input.addEventListener("blur", remember);
    toggle.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        toggle.setAttribute("aria-expanded", String(!panel.hidden));
    });
    for (const [symbol, name] of choices) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = symbol;
        button.setAttribute("aria-label", name);
        button.addEventListener("click", () => {
            if (!input.disabled && (!input.maxLength || input.maxLength < 0 || input.value.length - (end - start) + symbol.length <= input.maxLength)) {
                input.focus();
                input.setRangeText(symbol, start, end, "end");
                input.dispatchEvent(new Event("input", { bubbles: true }));
                remember();
            }
            panel.hidden = true;
            toggle.setAttribute("aria-expanded", "false");
        });
        panel.append(button);
    }
    wrapper.addEventListener("keydown", event => {
        if (event.key === "Escape") { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); }
    });
    wrapper.append(toggle, panel);
    input.after(wrapper);
}
