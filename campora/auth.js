const loginForm = document.getElementById("auth-login");
const requestForm = document.getElementById("auth-request");
const verifyForm = document.getElementById("auth-verify");
const statusMessage = document.getElementById("auth-status");
const signupDetails = document.getElementById("signup-details");
const resetDetails = document.getElementById("reset-details");
let verification;
let creatingAccount = false;
const next = new URLSearchParams(window.location.search).get("next");
const adminSignIn = next === "/admin";
const title = document.getElementById("auth-title");
const instructions = document.getElementById("auth-instructions");
const defaultTitle = next === "/admin" ? "Sign in to the admin workspace" : "Sign in to Campora";
const defaultInstructions = next === "/admin"
    ? "Enter your moderator email address and password."
    : instructions.textContent;
title.textContent = defaultTitle;
instructions.textContent = defaultInstructions;

if (window.location.protocol === "file:") {
    loginForm.hidden = true;
    document.getElementById("auth-local").hidden = false;
}

function showForm(form, heading, description) {
    for (const item of [loginForm, requestForm, verifyForm]) item.hidden = item !== form;
    title.textContent = heading;
    instructions.textContent = description;
    statusMessage.textContent = "";
    form.querySelector("input").focus();
}

function showPasswordRequest() {
    signupDetails.hidden = signupDetails.disabled = !creatingAccount;
    const directSignup = creatingAccount && !adminSignIn;
    requestForm.querySelector('[type="submit"]').textContent = directSignup ? "Create account" : "Send verification code";
    showForm(requestForm, creatingAccount ? "Create your Campora account" : "Set or reset your password",
        creatingAccount ? (adminSignIn ? "Enter your moderator account details, then verify your email." : "Fill in your account details. Your email stays private.")
            : "Verify the email on your account to choose a password.");
}

const finish = result => window.location.replace(result.destination);

loginForm.addEventListener("submit", event => {
    event.preventDefault();
    submit(loginForm, "/auth/login", {
        email: loginForm.elements.email.value.trim(),
        password: loginForm.elements.password.value,
        next
    }, finish);
});

for (const id of ["auth-create", "auth-reset"]) {
    document.getElementById(id).addEventListener("click", () => {
        creatingAccount = id === "auth-create";
        verification = undefined;
        verifyForm.reset();
        requestForm.reset();
        requestForm.elements.email.value = loginForm.elements.email.value;
        loginForm.elements.password.value = "";
        showPasswordRequest();
    });
}

document.getElementById("auth-signin").addEventListener("click", () => {
    loginForm.elements.email.value = requestForm.elements.email.value;
    showForm(loginForm, defaultTitle, defaultInstructions);
});

async function submit(form, path, data, onSuccess) {
    const buttons = [...form.querySelectorAll("button")];
    if (form.dataset.pending) return;
    form.dataset.pending = "true";
    buttons.forEach(button => button.disabled = true);
    statusMessage.dataset.state = "pending";
    statusMessage.textContent = "Working…";
    try {
        const response = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(typeof data === "function" ? await data() : data)
        });
        const result = await response.json();
        if (response.ok) {
            onSuccess(result);
        } else {
            statusMessage.dataset.state = "error";
            statusMessage.textContent = result.error;
        }
    } catch (error) {
        statusMessage.dataset.state = "error";
        statusMessage.textContent = error instanceof TypeError ? "Campora could not connect. Try again." : error.message;
    } finally {
        delete form.dataset.pending;
        buttons.forEach(button => button.disabled = false);
    }
}

function showVerification() {
    resetDetails.hidden = resetDetails.disabled = creatingAccount;
    verifyForm.querySelector('[type="submit"]').textContent = creatingAccount ? "Verify and create account" : "Save password and sign in";
    document.getElementById("auth-back").textContent = creatingAccount ? "Edit account details" : "Change email";
    showForm(verifyForm, "Check your inbox", "Enter the 8-digit code for " + verification.email +
        (creatingAccount ? "." : " and choose a password."));
    statusMessage.dataset.state = "success";
    statusMessage.textContent = verification.previewCode
        ? "Local preview code: " + verification.previewCode
        : "Check your spam folder if the email doesn’t arrive.";
}

function requestCode(form, email) {
    const mode = creatingAccount ? "signup" : "password";
    submit(form, "/auth/request", { email, mode }, result => {
        verification = { email, mode, previewCode: result.previewCode, requestedAt: Date.now() };
        verifyForm.elements.code.value = "";
        showVerification();
    });
}

async function signupData() {
    const { email, password, name, username, department, bio, photo } = requestForm.elements;
    return {
        email: email.value.trim(),
        next,
        password: password.value,
        profile: {
            name: name.value,
            username: username.value,
            department: department.value,
            bio: bio.value,
            file: await campusUpload(photo.files[0])
        }
    };
}

requestForm.addEventListener("submit", event => {
    event.preventDefault();
    if (creatingAccount && !adminSignIn) {
        submit(requestForm, "/auth/signup", signupData, finish);
        return;
    }
    const email = requestForm.elements.email.value.trim();
    if (verification?.email === email && Date.now() - verification.requestedAt < 9 * 60_000) {
        showVerification();
    } else {
        requestCode(requestForm, email);
    }
});

document.getElementById("auth-resend").addEventListener("click", () => requestCode(verifyForm, verification.email));

verifyForm.addEventListener("submit", event => {
    event.preventDefault();
    submit(verifyForm, "/auth/verify", async () => {
        const data = creatingAccount ? await signupData() : { next, password: verifyForm.elements.password.value };
        return {
            ...data,
            email: verification.email,
            mode: verification.mode,
            code: verifyForm.elements.code.value.trim()
        };
    }, finish);
});

document.getElementById("auth-back").addEventListener("click", () => {
    showPasswordRequest();
});
