document.addEventListener("DOMContentLoaded", () => {
    const target = new URLSearchParams(location.search).get("id");
    const get = id => document.getElementById(id);
    let profile;
    get("editSocialProfileBtn").hidden = true;
    try {
        document.body.classList.toggle("dark-mode", localStorage.getItem(window.camporaAccountId + ":camporaDarkMode") === "true");
    } catch {}
    async function loadProfile() {
        profile = await campusApi("profile" + (target ? "?id=" + encodeURIComponent(target) : ""));
        document.title = (profile.name || "Student profile") + " | Campora";
        get("socialProfileName").textContent = profile.name || "Anchor student";
        get("socialProfileUsername").textContent = profile.username ? "@" + profile.username : "";
        get("socialProfileBio").textContent = profile.bio || "";
        get("socialProfileDepartment").textContent = profile.department || "";
        get("socialProfilePicture").src = profile.picture || "/favicon.png";
        get("editSocialProfileBtn").hidden = !profile.own;
        get("followProfileBtn").hidden = profile.own;
        get("followProfileBtn").textContent = profile.followed ? "Unfollow" : "Follow";
        get("messageProfileLink").hidden = profile.own;
        get("messageProfileLink").href = "/?message=" + encodeURIComponent(profile.id);
        get("followProfileBtn").setAttribute("aria-pressed", String(profile.followed));
        get("profileCounts").textContent = profile.followers + " followers · " + profile.following + " following";
    }
    async function loadPosts() {
        const posts = await campusApi("profile-posts?id=" + encodeURIComponent(profile.id));
        get("publicProfilePosts").replaceChildren(...posts.map(post => {
            const article = document.createElement("article");
            article.className = "campus-tools";
            const text = document.createElement("p");
            text.textContent = post.text;
            const open = document.createElement("a");
            open.href = "/?post=" + encodeURIComponent(post.id);
            open.className = "auth-secondary";
            open.textContent = "Open post";
            article.append(text);
            if (post.file) {
                const video = post.file.type.startsWith("video/");
                const media = document.createElement(video ? "video" : "img");
                media.src = post.file.url;
                if (video) media.controls = true;
                else { media.alt = "Post attachment"; media.loading = "lazy"; }
                article.append(media);
            }
            article.append(open);
            return article;
        }));
        if (!posts.length) get("publicProfilePosts").textContent = "No visible posts yet.";
    }
    get("followProfileBtn").addEventListener("click", event => campusAction(event.currentTarget, async () => {
        await campusApi("follow", { peer: profile.id, enabled: !profile.followed });
        await loadProfile();
    }));
    get("editSocialProfileBtn").addEventListener("click", () => location.assign("/#profile"));
    loadProfile().then(loadPosts).catch(error => {
        get("socialProfileName").textContent = "Profile unavailable";
        get("followProfileBtn").hidden = true;
        get("messageProfileLink").hidden = true;
        get("editSocialProfileBtn").hidden = true;
        get("publicProfilePosts").replaceChildren();
        campusError(error);
    });
});
