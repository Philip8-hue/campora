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
