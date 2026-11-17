// A bare test page for the spike, not the editor. It sets up a passkey, signs in and publishes.
export const EDIT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Write path spike</title>
<style>
body { font: 16px/1.5 ui-sans-serif, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; color: #1b1f27; background: #f6f7f9; }
fieldset { border: 1px solid #ccd; border-radius: 8px; margin: 0 0 1rem; padding: 1rem; }
input, textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 0.4rem; }
textarea { min-height: 10rem; font-family: ui-monospace, monospace; font-size: 14px; }
button { font: inherit; padding: 0.5rem 1rem; margin-top: 0.5rem; min-height: 44px; }
output { display: block; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 13px; margin-top: 1rem; }
</style>
</head>
<body>
<h1>Write path spike</h1>
<p id="who">Checking who you are…</p>
<fieldset><legend>First passkey</legend>
<label>Setup token <input id="setup" type="password" autocomplete="off"></label>
<button id="register" type="button">Create a passkey</button></fieldset>
<fieldset><legend>Sign in</legend><button id="login" type="button">Sign in with your passkey</button> <button id="logout" type="button">Sign out</button></fieldset>
<fieldset><legend>Publish</legend>
<label>Slug <input id="slug" value="hello-from-the-editor"></label>
<label>Base revision <input id="base" value="0" inputmode="numeric"></label>
<label>index.md <textarea id="md">---
title: "Hello from the editor"
date: 2026-11-16
summary: "A post published through the spike's write path."
tags: [site]
draft: false
---

Written in the browser, stored in D1.</textarea></label>
<button id="publish" type="button">Publish</button></fieldset>
<output id="out" aria-live="polite"></output>
<script type="module" src="/edit.js"></script>
</body>
</html>`;

export const EDIT_JS = `
const out = document.getElementById("out");
const show = (x) => (out.textContent = typeof x === "string" ? x : JSON.stringify(x, null, 2));
async function post(path, body, headers = {}) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body ?? {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? (data.errors ?? []).join("; ") ?? res.status);
  return data;
}
async function me() {
  const res = await fetch("/api/me");
  document.getElementById("who").textContent = res.ok ? "Signed in as " + (await res.json()).writer : "Not signed in.";
}
document.getElementById("register").onclick = async () => {
  try {
    const token = { "x-setup-token": document.getElementById("setup").value };
    const options = await post("/auth/register/options", {}, token);
    const cred = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) });
    show(await post("/auth/register/verify", cred.toJSON(), token));
  } catch (e) { show("Passkey not created: " + e.message); }
};
document.getElementById("login").onclick = async () => {
  try {
    const options = await post("/auth/login/options");
    const cred = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) });
    show(await post("/auth/login/verify", cred.toJSON()));
    await me();
  } catch (e) { show("Not signed in: " + e.message); }
};
document.getElementById("logout").onclick = async () => { await post("/auth/logout"); await me(); show("Signed out."); };
document.getElementById("publish").onclick = async () => {
  try {
    show(await post("/api/publish", { slug: document.getElementById("slug").value, baseRevision: Number(document.getElementById("base").value), files: { "index.md": { text: document.getElementById("md").value } } }));
  } catch (e) { show("Not published: " + e.message); }
};
me();
`;
