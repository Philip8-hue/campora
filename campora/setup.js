const setupForm = document.getElementById("setup-form");
const setupFields = setupForm.querySelector("fieldset");

async function loadSetup() {
    const profile = await campusApi("profile");
    for (const field of ["name", "department", "bio"]) {
        setupForm.elements[field].value = profile[field] || "";
    }
    setupFields.disabled = false;
}

setupForm.addEventListener("submit", event => {
    event.preventDefault();
    campusAction(event.submitter, async () => {
        const { name, username, department, bio, photo } = setupForm.elements;
        await campusApi("profile", {
            name: name.value.trim(),
            username: username.value,
            department: department.value,
            bio: bio.value,
            file: await campusUpload(photo.files[0])
        });
        // The setup route validates and restores the original destination.
        window.location.reload();
    });
});

loadSetup().catch(campusError);
