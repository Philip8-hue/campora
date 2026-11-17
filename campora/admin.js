const listingForm = document.getElementById("listingForm");
const publishListing = document.getElementById("publishListing");
const dateLabel = document.getElementById("listingDateLabel");
function updateDateField(kind) {
    listingForm.elements.date.required = kind === "event";
    dateLabel.textContent = kind === "event" ? "Event date" : "Deadline (optional)";
}
listingForm.elements.kind.addEventListener("change", () => updateDateField(listingForm.elements.kind.value));
listingForm.addEventListener("reset", () => {
    listingForm.elements.id.value = "";
    publishListing.textContent = "Publish listing";
    updateDateField("event");
});
listingForm.addEventListener("submit", event => {
    event.preventDefault();
    campusAction(event.submitter, async () => {
        await campusApi("moderation/listings", Object.fromEntries(new FormData(listingForm)));
        listingForm.reset();
        await loadModeration();
    });
});

async function loadModeration() {
    const [records, broadcast] = await Promise.all([campusApi("moderation"), campusApi("broadcast")]);
    const listings = document.getElementById("moderatorListings");
    listings.replaceChildren(...records.listings.map(listing => {
        const row = listingRow(listing);
        row.append(campusButton("Edit", () => {
            for (const key of ["id", "kind", "title", "date", "details", "url"]) listingForm.elements[key].value = listing[key];
            updateDateField(listing.kind);
            publishListing.textContent = "Save changes";
            listingForm.elements.title.focus();
        }), campusButton("Remove", async () => {
            await campusApi("moderation/remove-listing", { id: listing.id });
            await loadModeration();
        }));
        return row;
    }));
    if (!records.listings.length) listings.textContent = "No listings have been published yet.";
    const reports = document.getElementById("moderatorReports");
    reports.replaceChildren(...records.reports.map(report => {
        const row = listingRow({ title: report.hidden ? "Hidden post" : "Reported post", details: report.body });
        const count = document.createElement("p");
        count.textContent = report.reports + (report.reports === 1 ? " report" : " reports");
        const review = async action => {
            await campusApi("moderation/reports", { id: report.id, action });
            await loadModeration();
        };
        row.append(count, campusButton(report.hidden ? "Restore post" : "Hide post", () => review(report.hidden ? "restore" : "hide")));
        if (!report.hidden) row.append(campusButton("Dismiss reports", () => review("dismiss")));
        row.append(campusButton("Delete post", async () => {
            if (!window.confirm("Permanently delete this post and its comments?")) return;
            await campusApi("posts/" + report.id + "/delete", {});
            await loadModeration();
        }));
        return row;
    }));
    if (!records.reports.length) reports.textContent = "No reports to review.";
    const streams = document.getElementById("moderatorBroadcasts");
    streams.replaceChildren(...broadcast.rooms.map(room => {
        const row = listingRow({ title: room.title });
        row.append(campusButton("End broadcast", async () => {
            await campusApi("broadcast", { action: "end", id: room.id });
            await loadModeration();
        }));
        return row;
    }));
    if (!broadcast.rooms.length) streams.textContent = "No active broadcasts.";
}

async function loadAccounts(offset = 0) {
    const { accounts, hasMore, ownId } = await campusApi("moderation/users?offset=" + offset);
    const list = document.getElementById("moderatorAccounts");
    list.replaceChildren(...accounts.map(account => {
        const row = listingRow({
            title: account.name || account.username || "Campora account",
            details: account.email + (account.disabled ? " · Disabled" : " · Active")
        });
        if (account.id !== ownId) row.append(campusButton(account.disabled ? "Restore access" : "Disable account", async () => {
            if (!account.disabled && !window.confirm("Disable this account and end its current sessions?")) return;
            await campusApi("moderation/users", { id: account.id, disabled: !account.disabled });
            await loadAccounts(offset);
        }));
        return row;
    }));
    if (!accounts.length) list.textContent = "No accounts found.";
    const pages = document.getElementById("moderatorAccountPages");
    pages.replaceChildren();
    if (offset > 0) pages.append(campusButton("Previous", () => loadAccounts(offset - 50)));
    if (hasMore) pages.append(campusButton("Next", () => loadAccounts(offset + 50)));
}

loadAccounts().catch(error => {
    document.getElementById("moderatorAccounts").textContent = "Couldn’t load accounts.";
    campusError(error);
});

loadModeration().catch(error => {
    for (const id of ["moderatorReports", "moderatorListings", "moderatorBroadcasts"]) {
        document.getElementById(id).textContent = "Couldn’t load these records. Reload the page to try again.";
    }
    campusError(error);
});
