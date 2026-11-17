
/* ===== CAMPORA PROFILE PAGE DATA ===== */

document.addEventListener("DOMContentLoaded", () => {
    const DEFAULT_PICTURE =
        "/favicon.png";

    const get = id => document.getElementById(id);

    async function loadProfile() {
        const profile = await campusApi("profile");
        get("socialProfileName").textContent = profile.name || "Your Name";
        get("socialProfileUsername").textContent = profile.name
            ? "@" + profile.name.trim().toLowerCase()
                .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
            : "@campora_student";

        get("socialProfileBio").textContent =
            profile.bio || "Welcome to my Campora profile!";
        get("socialProfileDepartment").textContent =
            profile.department || "Your Department";
        get("socialProfilePicture").src =
            profile.picture || DEFAULT_PICTURE;
    }

    loadProfile().catch(error => { get("socialProfileBio").textContent = error.message; });

    // Open the existing editor on the original tab for now.
    get("editSocialProfileBtn").addEventListener("click", () => {
        window.location.href = "/#profile";
    });
});
