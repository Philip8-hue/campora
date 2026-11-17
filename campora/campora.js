
document.addEventListener("DOMContentLoaded", () => {
    const feed = document.querySelector(".feed-section");
    const storiesList = document.querySelector(".stories-list");
    const storyUpload = document.getElementById("storyUpload");



    // ---------- CREATE POST MODAL ----------

    function openComposer(mode = "post") {
        document.querySelector(".composer-modal-overlay")?.remove();

        const isConfession = mode === "confession";
        const isPoll = mode === "poll";

        const overlay = document.createElement("div");
        overlay.className = "composer-modal-overlay";

        overlay.innerHTML = `
            <section class="composer-modal" role="dialog"
                aria-modal="true" aria-labelledby="composerTitle">

                <header class="composer-modal-header">
                    <h2 id="composerTitle">
                        ${isConfession ? "Create an anonymous post" :
                          isPoll ? "Create a campus poll" : "Create post"}
                    </h2>
                    <button type="button" class="composer-close"
                        aria-label="Close">&times;</button>
                </header>

                <form class="composer-form">
                    <div class="composer-identity">
                        <div class="avatar">${isConfession ? "A" : "Y"}</div>
                        <div>
                            <strong>${isConfession ? "Anonymous Student" : "You"}</strong>
                            <p>Sharing with your campus</p>
                        </div>
                    </div>

                    <textarea class="composer-textarea"
                        placeholder="${isPoll ? "Ask your campus a question..." :
                          "What's happening on campus? Share it with everyone..."}"
                        aria-label="Write your post" maxlength="3000"></textarea>

                    ${isPoll ? `
                        <input class="poll-input" placeholder="First option" aria-label="First option" maxlength="160" required>
                        <input class="poll-input" placeholder="Second option" aria-label="Second option" maxlength="160" required>
                    ` : ""}

                    ${!isPoll ? `
                        <div class="composer-media-preview"></div>
                        <label class="composer-upload">
                            <span>Add photos or videos</span>
                            <input class="composer-file" type="file"
                                accept="image/*,video/*" hidden>
                        </label>
                    ` : ""}

                    ${!isConfession ? `
                        <label class="composer-anonymous">
                            <input type="checkbox" class="anonymous-check">
                            Post anonymously
                        </label>
                    ` : ""}

                    <button type="submit" class="composer-publish">
                        ${isPoll ? "Publish poll" : "Post"}
                    </button>
                </form>
            </section>
        `;

        document.body.appendChild(overlay);

        const form = overlay.querySelector(".composer-form");
        const textarea = overlay.querySelector(".composer-textarea");
        const fileInput = overlay.querySelector(".composer-file");
        const preview = overlay.querySelector(".composer-media-preview");
        let selectedFile = null;
        let previewURL = null;

        textarea.addEventListener("input", () => textarea.setCustomValidity(""));
        const trigger = document.activeElement;
        textarea.focus();
        function closeComposer() {
            if (previewURL) URL.revokeObjectURL(previewURL);
            document.removeEventListener("keydown", closeOnEscape);
            overlay.remove();
            trigger?.focus();
        }

        function closeOnEscape(event) {
            if (event.key === "Escape") closeComposer();
        }

        overlay.querySelector(".composer-close").addEventListener("click", closeComposer);
        overlay.addEventListener("click", event => {
            if (event.target === overlay) closeComposer();
        });
        document.addEventListener("keydown", closeOnEscape);

        fileInput?.addEventListener("change", () => {
            textarea.setCustomValidity("");
            selectedFile = fileInput.files[0];
            if (previewURL) URL.revokeObjectURL(previewURL);
            previewURL = null;
            preview.replaceChildren();

            if (!selectedFile) return;

            if (!selectedFile.type.startsWith("image/") &&
                !selectedFile.type.startsWith("video/")) {
                selectedFile = null;
                fileInput.value = "";
                preview.textContent = "Please select an image or video.";
                return;
            }

            previewURL = URL.createObjectURL(selectedFile);

            let media;
            if (selectedFile.type.startsWith("image/")) {
                media = document.createElement("img");
                media.alt = "Post preview";
            } else {
                media = document.createElement("video");
                media.controls = true;
            }

            media.src = previewURL;
            media.className = "composer-preview-media";
            preview.appendChild(media);
        });

        form.addEventListener("submit", event => {
            event.preventDefault();

            const text = textarea.value.trim();
            if (!text && !selectedFile) {
                textarea.setCustomValidity("Write a post or attach a photo or video.");
                textarea.reportValidity();
                return;
            }

            const anonymous = isConfession ||
                Boolean(overlay.querySelector(".anonymous-check")?.checked);

            const pollData = isPoll ? {
                question: text,
                options: [...overlay.querySelectorAll(".poll-input")]
                    .map(input => input.value.trim())
            } : null;

            if (isPoll && pollData.options.some(option => !option)) return;

            campusAction(form.querySelector('[type="submit"]'), async () => {
                const saved = await campusApi("feed", {
                    text, anonymous, file: await campusUpload(selectedFile), poll: pollData?.options
                });
                renderPost(saved);
                applyFeedFilter();
                closeComposer();
            });
        });
    }

    function renderPost(record, savedView = false) {
        const { id, text, anonymous, file, poll, author: authorName } = record;
        if (!savedView) document.getElementById("emptyFeed").hidden = true;
        const post = document.createElement("article");
        post.className = "post card";
        post.dataset.author = authorName;
        post.dataset.authorId = record.own ? "current-user" : "";
        post.dataset.postId = id;
        post.dataset.anonymous = String(anonymous);

        const header = document.createElement("div");
        header.className = "post-header";

        const avatar = document.createElement("div");
        avatar.className = "avatar";
        avatar.textContent = authorName.charAt(0).toUpperCase();

        const author = document.createElement("div");
        author.className = "post-author";

        const name = document.createElement("strong");
        name.textContent = record.own && !anonymous ? "You" : authorName;

        const time = document.createElement("p");
        time.textContent = new Date(record.created).toLocaleString();

        author.append(name, time);

        const menu = document.createElement("button");
        menu.className = "more-button";
        menu.type = "button";
        menu.textContent = "•••";
        menu.setAttribute("aria-label", "Post options");

        header.append(avatar, author, menu);

        const content = document.createElement("p");
        content.className = "post-text";
        content.textContent = text;

        post.append(header);

        if (anonymous) {
            const tag = document.createElement("span");
            tag.className = "post-tag";
            tag.textContent = "Anonymous Post";
            post.append(tag);
        }

        post.append(content);

        if (file) {
            const mediaURL = file.url;
            const media = document.createElement(
                file.type.startsWith("video/") ? "video" : "img"
            );

            media.src = mediaURL;
            media.className = "post-attachment";

            if (media.tagName === "VIDEO") media.controls = true;
            else media.alt = "Post attachment";

            post.append(media);
        }

        if (poll) {
            const pollBox = document.createElement("div");
            pollBox.className = "poll";

            const results = document.createElement("p");
            results.className = "poll-footer";
            results.textContent = "0 votes";

            function showVotes(current) {
                const total = current.votes.reduce((sum, value) => sum + value, 0);
                results.textContent = total + (total === 1 ? " vote" : " votes");
                [...pollBox.querySelectorAll("button")].forEach((button, i) => {
                    button.lastElementChild.textContent = total ? Math.round(current.votes[i] / total * 100) + "%" : "";
                    button.setAttribute("aria-pressed", String(current.choice === i));
                    button.disabled = current.choice !== null;
                });
            }
            poll.options.forEach((optionText, index) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "poll-option";
                const label = document.createElement("span");
                label.textContent = optionText;
                button.append(label, document.createElement("span"));
                button.addEventListener("click", () => {
                    campusApi("posts/" + id + "/vote", { choice: index })
                        .then(updated => showVotes(updated.poll)).catch(campusError);
                });
                pollBox.append(button);
            });
            showVotes(poll);
            pollBox.appendChild(results);
            post.appendChild(pollBox);
        }

        const actions = document.createElement("div");
        actions.className = "post-actions";
        actions.innerHTML = `
            <button type="button" class="like-button">Like</button>
            <button type="button" class="comment-button">Comment</button>
            <button type="button" class="share-button">Copy post link</button>
            <button type="button" class="bookmark-btn">Save</button>
        `;

        post.append(actions);

        if (!savedView) feed.querySelector(".section-heading").insertAdjacentElement("afterend", post);
        connectPostActions(post, record);
        return post;
    }

    async function refreshFeed() {
        const sharedId = new URLSearchParams(window.location.search).get("post");
        const posts = await campusApi("feed");
        if (sharedId) {
            try {
                const shared = await campusApi("post?id=" + encodeURIComponent(sharedId));
                const existing = posts.findIndex(post => post.id === shared.id);
                if (existing !== -1) posts.splice(existing, 1);
                posts.unshift(shared);
            } catch (error) { campusError(error); }
        }
        feed.querySelectorAll("[data-post-id]").forEach(post => post.remove());
        document.getElementById("emptyFeed").hidden = posts.length > 0;
        posts.reverse().forEach(post => renderPost(post));
        applyFeedFilter();
    }

    const feedFilters = [...document.querySelectorAll(".feed-filters button")];
    function applyFeedFilter() {
        const confessions = document.getElementById("feedFilterConfessions").classList.contains("active");
        feed.querySelectorAll("[data-post-id]").forEach(post => {
            post.hidden = confessions && post.dataset.anonymous !== "true";
        });
    }
    feedFilters.forEach(button => button.addEventListener("click", () => {
        feedFilters.forEach(filter => filter.classList.toggle("active", filter === button));
        applyFeedFilter();
    }));

    window.refreshCampusFeed = refreshFeed;
    window.renderCampusPost = renderPost;
    refreshFeed().catch(campusError);

    // ---------- LIKE, COMMENT, SHARE ----------

   
function connectPostActions(post, record) {
    const likeButton = post.querySelector(".like-button");
    const commentButton = post.querySelector(".comment-button");
    const shareButton = post.querySelector(".share-button");

    // Create a count display if one does not already exist.
    function addCount(button, className) {
        if (!button) return null;

        let count = button.querySelector(".action-count");

        if (!count) {
            count = document.createElement("span");
            count.className = `action-count ${className}`;
            count.textContent = "0";
            button.appendChild(count);
        }

        return count;
    }

    const likeCount = addCount(likeButton, "like-count");
    const commentCount = addCount(commentButton, "comment-count");

    // Prevent duplicate event handlers if this function runs again.
    if (post.dataset.actionsConnected === "true") return;
    post.dataset.actionsConnected = "true";

    if (record) {
        const path = "posts/" + record.id + "/";
        const saveButton = post.querySelector(".bookmark-btn");
        function update(updated) {
            record = updated;
            likeCount.textContent = record.likes;
            commentCount.textContent = record.comments;
            likeButton.setAttribute("aria-pressed", String(record.liked));
            likeButton.classList.toggle("liked", record.liked);
            likeButton.firstChild.textContent = record.liked ? "Unlike " : "Like ";
            saveButton.textContent = record.saved ? "Remove from saved" : "Save";
        }
        update(record);
        likeButton.addEventListener("click", () => campusAction(likeButton, async () => {
            update(await campusApi(path + "like", { enabled: !record.liked }));
        }));
        saveButton.addEventListener("click", () => campusAction(saveButton, async () => {
            update(await campusApi(path + "save", { enabled: !record.saved }));
            if (!record.saved && (post.closest("#tab-saved") ||
                post.closest("#studentProfilePosts") && document.querySelector('[data-profile-tab="saved"].active'))) {
                post.remove();
            }
        }));
        commentButton.addEventListener("click", () => campusAction(commentButton, async () => {
            let area = post.querySelector(".comment-area");
            if (!area) {
                area = document.createElement("form");
                area.className = "comment-area";
                area.innerHTML = '<input aria-label="Write a comment" maxlength="1000" required><button type="submit">Send</button><div class="comment-list"></div>';
                post.querySelector(".post-actions").before(area);
                area.addEventListener("submit", event => {
                    event.preventDefault();
                    campusAction(area.querySelector("button"), async () => {
                        update(await campusApi(path + "comments", { text: area.querySelector("input").value }));
                        area.reset();
                        await refreshComments();
                    });
                });
            }
            async function refreshComments() {
                const comments = await campusApi(path + "comments");
                area.querySelector(".comment-list").replaceChildren(...comments.map(comment => {
                    const line = document.createElement("p");
                    line.textContent = comment.author + ": " + comment.text;
                    return line;
                }));
            }
            await refreshComments();
            area.querySelector("input").focus();
        }));
    }

    shareButton.addEventListener("click", () => campusAction(shareButton, async () => {
        const url = new URL("/", window.location.origin);
        url.searchParams.set("post", record.id);
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(url.href);
            shareButton.textContent = "Link copied";
        } else if (navigator.share) {
            await navigator.share({ title: "Campora post", url: url.href });
        } else {
            throw new Error("Link sharing requires a secure connection.");
        }
    }));

    // POST OPTIONS
    post.querySelector(".more-button")?.addEventListener("click", event => {
        const button = event.currentTarget;
        let menu = post.querySelector(".post-menu");

        if (menu) {
            menu.remove();
            return;
        }

        menu = document.createElement("div");
        menu.className = "post-menu";

        const reportButton = document.createElement("button");
        reportButton.type = "button";
        reportButton.textContent = "Report post";

        reportButton.addEventListener("click", async () => {
            if (!record) return;
            try { await campusApi("posts/" + record.id + "/report", {}); }
            catch (error) { campusError(error); return; }
            reportButton.textContent = "Report submitted";
        });

        menu.appendChild(reportButton);
        post.querySelector(".post-header").after(menu);
    });
}


    function actionsAfterPost(post) {
        return post.querySelector(".post-actions");
    }

    // ---------- STANDARD STORIES ----------

    function renderStory(story) {
        const url = story.url;

        const card = document.createElement("button");
        card.type = "button";
        card.className = "story-card own-story";

        const ring = document.createElement("span");
        ring.className = "story-ring";

        const thumbnail = document.createElement("span");
        thumbnail.className = "story-thumbnail";

        const thumb = document.createElement(story.type.startsWith("video/") ? "video" : "img");
        thumb.src = url;
        thumb.alt = "Your story preview";

        if (story.type.startsWith("video/")) {
            thumb.muted = true;
            thumb.playsInline = true;
        }

        thumbnail.appendChild(thumb);
        ring.appendChild(thumbnail);

        const label = document.createElement("span");
        label.className = "story-name";
        label.textContent = story.author;

        card.append(ring, label);

        // The Add Story tile remains first.
        const addTile = storiesList.querySelector(".add-story");
        addTile.insertAdjacentElement("afterend", card);

        card.addEventListener("click", () => openStoryViewer(story));
    }

    function openStoryViewer(story) {
        const viewer = document.createElement("div");
        viewer.className = "story-viewer";

        const topBar = document.createElement("div");
        topBar.className = "story-viewer-top";

        const title = document.createElement("span");
        title.textContent = story.author;

        const close = document.createElement("button");
        close.type = "button";
        close.className = "story-viewer-close";
        close.textContent = "×";
        close.setAttribute("aria-label", "Close story");

        topBar.append(title, close);

        const media = document.createElement(story.type.startsWith("video/") ? "video" : "img");
        media.className = "story-viewer-media";
        media.src = story.url;
        media.alt = "Story";

        if (story.type.startsWith("video/")) {
            media.controls = true;
            media.autoplay = true;
            media.playsInline = true;
        }

        viewer.append(topBar, media);
        document.body.appendChild(viewer);

        close.addEventListener("click", () => viewer.remove());

        viewer.addEventListener("click", event => {
            if (event.target === viewer) viewer.remove();
        });

        close.focus();
        viewer.addEventListener("keydown", event => {
            if (event.key === "Escape") viewer.remove();
        });
    }

    async function refreshStories() {
        const stories = await campusApi("stories");
        storiesList.querySelectorAll(".own-story").forEach(story => story.remove());
        stories.reverse().forEach(renderStory);
    }
    refreshStories().catch(campusError);

    storyUpload?.addEventListener("change", () => {
        const file = storyUpload.files[0];

        if (file) campusUpload(file).then(upload => campusApi("stories", { file: upload })).then(refreshStories).catch(campusError);

        // Allow the same file to be selected again.
        storyUpload.value = "";
    });

    document.getElementById("createPostBtn")
        ?.addEventListener("click", () => openComposer());

    document.getElementById("composerPrompt")
        ?.addEventListener("click", () => openComposer());

    document.getElementById("photoPostBtn")
        ?.addEventListener("click", () => openComposer());

    document.getElementById("pollBtn")
        ?.addEventListener("click", () => openComposer("poll"));

    document.getElementById("confessionBtn")
        ?.addEventListener("click", () => openComposer("confession"));

});

/* ==============================================================
   CAMPORA NIGERIA - 12 CORE PLATFORM MODULES CONTROLLER
   Home, Explore, Search, Reels, Live, Communities, Messages,
   Saved, Opportunities, Notifications, My Profile, Settings
================================================================= */

document.addEventListener("DOMContentLoaded", () => {
    // ---------- NAVIGATION CONTROLLER (ALL 12 TABS) ----------
    const navLinks = document.querySelectorAll("[data-nav]");
    const tabPages = document.querySelectorAll(".tab-page");
    const menuButton = document.querySelector(".mobile-menu-button");
    const campusNavigation = document.getElementById("campusNavigation");

    menuButton.addEventListener("click", () => {
        const expanded = menuButton.getAttribute("aria-expanded") === "true";
        menuButton.setAttribute("aria-expanded", String(!expanded));
    });

    menuButton.closest(".sidebar").addEventListener("keydown", event => {
        if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
            menuButton.setAttribute("aria-expanded", "false");
            menuButton.focus();
        }
    });

    document.addEventListener("click", event => {
        if (!menuButton.closest(".sidebar").contains(event.target)) {
            menuButton.setAttribute("aria-expanded", "false");
        }
    });

    function switchTab(targetName) {
        if (!targetName) return;

        if (menuButton.getAttribute("aria-expanded") === "true") {
            menuButton.setAttribute("aria-expanded", "false");
            if (campusNavigation.contains(document.activeElement) && menuButton.offsetWidth) {
                menuButton.focus();
            }
        }

        tabPages.forEach(page => {
            page.classList.remove("active");
        });

        const targetPage = document.getElementById(`tab-${targetName}`);
        if (targetPage) {
            targetPage.classList.add("active");
            window.scrollTo({ top: 0 });
        }

        navLinks.forEach(link => {
            if (link.dataset.nav === targetName) {
                link.classList.add("active");
                if (!link.classList.contains("logo")) link.setAttribute("aria-current", "page");
            } else {
                link.classList.remove("active");
                link.removeAttribute("aria-current");
            }
        });

        refreshCampusOperations(targetName);

        // Trigger tab-specific refresh
        if (targetName === "profile") {
            refreshProfileView().catch(campusError);
        } else if (targetName === "search") {
            loadSearch().catch(campusError);
        } else if (targetName === "saved") {
            renderSavedBookmarks().catch(campusError);
        } else if (targetName === "reels") {
            loadReels().catch(campusError);
        } else if (targetName === "messages") {
            loadStudents().catch(campusError);
        } else if (targetName === "live") {
            showMessages("campus-live", liveChatMessages, true).catch(campusError);
        } else if (targetName === "communities") {
            loadMemberships().catch(campusError);
        } else if (targetName === "notifications") {
            loadNotifications().catch(campusError);
        } else if (targetName === "home") {
            window.refreshCampusFeed().catch(campusError);
        }
    }

    navLinks.forEach(link => {
        link.addEventListener("click", event => {
            event.preventDefault();
            const tabName = link.dataset.nav;
            switchTab(tabName);
        });
    });

    document.getElementById("sidebarProfileTrigger")?.addEventListener("click", () => {
        switchTab("profile");
    });

    // ---------- SEARCH MODULE ----------
    const searchInput = document.getElementById("mainSearchInput");
    const searchHeader = document.getElementById("searchResultsHeader");
    const searchGrid = document.getElementById("searchResultsContainer");
    const searchFilterChips = document.querySelectorAll("#tab-search .filter-chip");
    let activeSearchFilter = "all";

    let searchableData = [];

    async function loadSearch() {
        const [students, posts, listings] = await Promise.all([campusApi("students"), campusApi("feed"), campusApi("listings")]);
        searchableData = [
            ...students.map(student => ({ type: "students", name: student.name, subtitle: [student.username && "@" + student.username, student.department || "Anchor University"].filter(Boolean).join(" · "), tag: "Student" })),
            ...posts.map(post => ({ type: "posts", name: post.text, subtitle: post.author, tag: "Post" })),
            ...[...document.querySelectorAll(".community-title")].map(title => ({ type: "communities", name: title.textContent, subtitle: "Anchor University", tag: "Community" })),
            ...listings.filter(listing => listing.kind === "opportunity").map(listing => ({ type: "opportunities", name: listing.title, subtitle: listing.details, tag: "Opportunity" }))
        ];
        renderSearchResults(searchInput.value);
    }

    function renderSearchResults(query = "") {
        if (!searchGrid) return;
        const q = query.toLowerCase().trim();

        const filtered = searchableData.filter(item => {
            const matchesType = (activeSearchFilter === "all" || item.type === activeSearchFilter);
            const matchesQuery = !q || item.name.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q);
            return matchesType && matchesQuery;
        });

        searchGrid.replaceChildren();

        if (filtered.length === 0) {
            searchGrid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--muted);">
                    
                    <p style="margin-top: 10px;"></p>
                </div>
            `;
            searchGrid.querySelector("p").textContent = `No campus results found for "${query}". Try searching another name or keyword.`;
            return;
        }

        filtered.forEach(item => {
            const card = document.createElement("div");
            card.className = "search-result-card";
            const content = document.createElement("div");
            const title = document.createElement("strong");
            title.textContent = item.name;
            const description = document.createElement("p");
            description.textContent = item.tag + " · " + item.subtitle;
            content.append(title, description);
            card.append(content);
            searchGrid.appendChild(card);
        });

        if (searchHeader) {
            searchHeader.textContent = q ? `Results for "${query}" (${filtered.length})` : "Suggested Profiles & Campus Hubs";
        }
    }

    searchInput?.addEventListener("input", () => {
        renderSearchResults(searchInput.value);
    });

    document.getElementById("executeSearchBtn")?.addEventListener("click", () => {
        renderSearchResults(searchInput?.value || "");
    });

    searchFilterChips.forEach(chip => {
        chip.addEventListener("click", () => {
            searchFilterChips.forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            activeSearchFilter = chip.dataset.filter || "all";
            renderSearchResults(searchInput?.value || "");
        });
    });

    async function loadReels() {
        const posts = await campusApi("feed?media=video");
        const reels = document.getElementById("reelsFeed");
        reels.replaceChildren(...posts.map(post => window.renderCampusPost(post, true)));
        if (!posts.length) reels.textContent = "Video posts from campus will appear here.";
    }

    const chatMessagesArea = document.getElementById("chatMessagesArea");
    const chatSendForm = document.getElementById("chatSendForm");
    const liveChatForm = document.getElementById("liveChatForm");
    const liveChatMessages = document.getElementById("liveChatMessages");
    let peer = null;

    async function showMessages(recipient, container, live = false) {
        const messages = await campusApi("messages?peer=" + encodeURIComponent(recipient));
        if (!live && recipient !== peer) return;
        const nearEnd = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
        if (container.lastElementChild?.dataset.messageId === String(messages.at(-1)?.id)) return;
        container.replaceChildren(...messages.map(message => {
            const bubble = document.createElement("div");
            bubble.dataset.messageId = message.id;
            bubble.className = live ? "live-chat-msg" : "chat-bubble " + (message.own ? "outgoing" : "incoming");
            bubble.textContent = live ? message.author + ": " + message.text : message.text;
            return bubble;
        }));
        if (nearEnd) container.scrollTop = container.scrollHeight;
    }

    async function loadStudents() {
        const students = await campusApi("students");
        const list = document.getElementById("chatThreadList");
        const search = document.querySelector(".messages-search-bar input");
        function showStudents() {
            const visible = students.filter(student => student.name.toLowerCase().includes(search.value.trim().toLowerCase()));
            list.replaceChildren(...visible.map(student => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "chat-thread-item";
                button.textContent = student.name + (student.department ? " · " + student.department : "");
                button.classList.toggle("active", peer === student.id);
                button.addEventListener("click", () => {
                    peer = student.id;
                    chatMessagesArea.replaceChildren();
                    document.getElementById("activeChatName").textContent = student.name;
                    document.getElementById("activeChatAvatar").textContent = student.name[0];
                    chatSendForm.hidden = false;
                    showStudents();
                    showMessages(peer, chatMessagesArea).catch(campusError);
                });
                return button;
            }));
            if (!visible.length) list.textContent = "No students found.";
        }
        search.oninput = showStudents;
        showStudents();
    }

    function connectChat(form, input, recipient, container, live) {
        form.addEventListener("submit", event => {
            event.preventDefault();
            const to = recipient();
            if (!to) return;
            campusAction(form.querySelector("button"), async () => {
                await campusApi("messages", { peer: to, text: input.value });
                if (live || to === peer) form.reset();
                await showMessages(to, container, live);
                container.scrollTop = container.scrollHeight;
            });
        });
    }
    chatSendForm.hidden = true;
    connectChat(chatSendForm, document.getElementById("chatMessageInput"), () => peer, chatMessagesArea, false);
    connectChat(liveChatForm, document.getElementById("liveChatInput"), () => "campus-live", liveChatMessages, true);

    const membershipButtons = [...document.querySelectorAll(".join-community-btn")];
    function showMembership(button, joined) {
        button.classList.toggle("joined", joined);
        button.textContent = joined ? "Leave" : "Join";
    }
    async function loadMemberships() {
        const [groups, rankings] = await Promise.all([campusApi("memberships"), campusApi("leaderboard")]);
        membershipButtons.forEach(button => {
            const name = button.dataset.community;
            const count = rankings.find(group => group.name === name)?.members || 0;
            button.closest(".community-card").querySelector(".community-stats").textContent = count + (count === 1 ? " member" : " members");
            showMembership(button, groups.includes(name));
        });
    }
    membershipButtons.forEach(button => button.addEventListener("click", () => campusAction(button, async () => {
        const result = await campusApi("memberships", {
            group: button.dataset.community, joined: !button.classList.contains("joined")
        });
        showMembership(button, result.joined);
        await loadMemberships();
    })));

    async function renderSavedBookmarks() {
        const posts = await campusApi("saved");
        const container = document.getElementById("savedItemsContainer");
        container.replaceChildren(...posts.map(post => window.renderCampusPost(post, true)));
        if (!posts.length) container.textContent = "Saved posts will appear here.";
    }

    async function loadNotifications() {
        const notifications = await campusApi("notifications");
        const container = document.getElementById("campusNotifications");
        function item(text, unread) {
            const row = document.createElement("p");
            row.className = "notification-item" + (unread ? " unread" : "");
            row.textContent = text;
            return row;
        }
        container.replaceChildren(
            item("More universities are coming soon. Campora is currently available at Anchor University.", !notifications.read),
            ...notifications.messages.map(message => item("Message from " + message.author + ": " + message.text, message.unread))
        );
    }
    const markRead = document.getElementById("markAllReadBtn");
    markRead.addEventListener("click", () => campusAction(markRead, async () => {
        await campusApi("notifications", {});
        await loadNotifications();
    }));

    setInterval(() => {
        if (document.hidden) return;
        if (document.getElementById("tab-messages").classList.contains("active") && peer) {
            showMessages(peer, chatMessagesArea).catch(campusError);
        } else if (document.getElementById("tab-live").classList.contains("active")) {
            showMessages("campus-live", liveChatMessages, true).catch(campusError);
        }
    }, 4000);

    // ---------- MY PROFILE & SETTINGS SYNC ----------
    const CAMPUS_NAME = "Anchor University, Lagos";
    const DEFAULT_PICTURE = "/favicon.png";
    let profile = {};

    async function refreshProfileView() {
        profile = await campusApi("profile");
        const name = profile.name || "Your Name";
        const dept = profile.department || "Department not set";
        const bio = profile.bio || "";
        const picture = profile.picture || DEFAULT_PICTURE;

        const elName = document.getElementById("socialProfileName");
        const elUsername = document.getElementById("socialProfileUsername");
        const elBio = document.getElementById("socialProfileBio");
        const elCampus = document.getElementById("socialProfileCampus");
        const elDept = document.getElementById("socialProfileDepartment");
        const elPic = document.getElementById("socialProfilePicture");

        if (elName) elName.textContent = name;
        if (elUsername) {
            elUsername.textContent = profile.username ? "@" + profile.username : "";
        }
        if (elBio) elBio.textContent = bio;
        if (elCampus) elCampus.textContent = CAMPUS_NAME;
        if (elDept) elDept.textContent = dept;
        if (elPic) elPic.src = picture;

        // Also update sidebar widget
        const sbName = document.getElementById("sidebarStudentName");
        const sbCampus = document.getElementById("sidebarStudentCampus");
        const sbAvatar = document.getElementById("sidebarAvatar");
        if (sbName) sbName.textContent = name;
        if (sbCampus) sbCampus.textContent = CAMPUS_NAME;
        if (sbAvatar) sbAvatar.textContent = name.charAt(0).toUpperCase();

        if (document.getElementById("tab-profile").classList.contains("active")) await renderProfilePosts();
    }

    const profileTabs = [...document.querySelectorAll("[data-profile-tab]")];
    let profileTab = "posts";
    let profileRequest = 0;

    async function renderProfilePosts() {
        const request = ++profileRequest;
        const selected = profileTab;
        const posts = await campusApi(selected === "saved" ? "saved" : "my-posts");
        if (request !== profileRequest) return;
        if (selected !== "saved") document.getElementById("profilePostsCount").textContent = posts.length;
        const filtered = selected === "media" ? posts.filter(post => post.file) : posts;
        const container = document.getElementById("studentProfilePosts");
        container.replaceChildren(...filtered.map(post => window.renderCampusPost(post, true)));
        if (!filtered.length) {
            const empty = document.createElement("p");
            empty.textContent = { posts: "You haven’t published any named posts yet.", media: "Your photo and video posts will appear here.", saved: "You haven’t saved any posts yet." }[selected];
            container.append(empty);
        }
    }

    for (const button of profileTabs) {
        button.setAttribute("aria-pressed", String(button.dataset.profileTab === profileTab));
        button.addEventListener("click", () => {
            profileTab = button.dataset.profileTab;
            profileTabs.forEach(tab => {
                tab.classList.toggle("active", tab === button);
                tab.setAttribute("aria-pressed", String(tab === button));
            });
            renderProfilePosts().catch(campusError);
        });
    }

    // Modal Profile Editor
    const profileModal = document.getElementById("profileModal");
    const editBtn = document.getElementById("editSocialProfileBtn");
    const closeProfileBtn = document.getElementById("closeProfileBtn");
    const profileForm = document.getElementById("profileForm");

    editBtn?.addEventListener("click", () => {
        if (!profileModal) return;
        const inName = document.getElementById("profileName");
        const inDept = document.getElementById("profileDepartment");
        const inBio = document.getElementById("profileBio");

        if (inName) inName.value = profile.name || "";
        if (inDept) inDept.value = profile.department || "";
        if (inBio) inBio.value = profile.bio || "";
        document.getElementById("profilePicturePreview").src = profile.picture || DEFAULT_PICTURE;

        profileModal.hidden = false;
        document.body.style.overflow = "hidden";
        inName.focus();
    });

    function closeProfileEditor() {
        profileModal.hidden = true;
        document.body.style.overflow = "";
        editBtn.focus();
    }

    closeProfileBtn?.addEventListener("click", closeProfileEditor);
    profileModal?.addEventListener("keydown", event => {
        if (event.key === "Escape") closeProfileEditor();
    });

    profileForm?.addEventListener("submit", event => {
        event.preventDefault();
        const inName = document.getElementById("profileName");
        const inDept = document.getElementById("profileDepartment");
        const inBio = document.getElementById("profileBio");

        const updated = {
            name: inName?.value.trim() || "Your Name",
            campus: CAMPUS_NAME,
            department: inDept.value.trim(),
            bio: inBio?.value.trim() || "Welcome to my Campora profile!",
            file: document.getElementById("profilePictureInput").files[0]
        };

        campusAction(profileForm.querySelector('[type="submit"]'), async () => {
            await campusApi("profile", { ...updated, file: await campusUpload(updated.file) });
            profileForm.reset();
            closeProfileEditor();
            await refreshProfileView();
        });
    });

    // Dark Mode Toggle in Settings
    const darkModeToggle = document.getElementById("darkModeToggle");
    darkModeToggle?.addEventListener("change", () => {
        if (darkModeToggle.checked) {
            document.body.classList.add("dark-mode");
            localStorage.setItem((window.camporaAccountId + ":camporaDarkMode"), "true");
        } else {
            document.body.classList.remove("dark-mode");
            localStorage.setItem((window.camporaAccountId + ":camporaDarkMode"), "false");
        }
    });

    if (localStorage.getItem((window.camporaAccountId + ":camporaDarkMode")) === "true") {
        document.body.classList.add("dark-mode");
        if (darkModeToggle) darkModeToggle.checked = true;
    }

    // Initial view sync
    if (window.location.hash === "#profile") switchTab("profile");
    else refreshProfileView().catch(campusError);
});
